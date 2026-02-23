<?php
/**
 * AgentTrust Station Client
 *
 * Handles communication with the AgentTrust Station server,
 * including public key retrieval, JWT certificate verification,
 * and report submission.
 *
 * @package AgentTrust_Gateway
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class AgentTrust_Station_Client {

    /**
     * The AgentTrust Station URL.
     *
     * @var string
     */
    private $station_url;

    /**
     * The API key for authenticating with the Station.
     *
     * @var string
     */
    private $api_key;

    /**
     * Transient key for caching the public key.
     *
     * @var string
     */
    const PUBLIC_KEY_TRANSIENT = 'agenttrust_station_public_key';

    /**
     * Cache duration for the public key in seconds (1 hour).
     *
     * @var int
     */
    const PUBLIC_KEY_CACHE_TTL = 3600;

    /**
     * Constructor.
     *
     * @param string $station_url The AgentTrust Station URL.
     * @param string $api_key     The API key for Station authentication.
     */
    public function __construct( $station_url, $api_key ) {
        $this->station_url = rtrim( $station_url, '/' );
        $this->api_key     = $api_key;
    }

    /**
     * Retrieve the Station public key for JWT verification.
     *
     * Fetches from {station_url}/.well-known/station-keys and caches
     * the result in a WordPress transient for 1 hour.
     *
     * @param bool $force_refresh Whether to bypass the cache.
     * @return string|false The PEM-encoded public key, or false on failure.
     */
    public function get_public_key( $force_refresh = false ) {
        if ( ! $force_refresh ) {
            $cached_key = get_transient( self::PUBLIC_KEY_TRANSIENT );
            if ( false !== $cached_key ) {
                return $cached_key;
            }
        }

        if ( empty( $this->station_url ) ) {
            return false;
        }

        $response = wp_remote_get(
            $this->station_url . '/.well-known/station-keys',
            array(
                'timeout' => 15,
                'headers' => array(
                    'Accept' => 'application/json',
                ),
            )
        );

        if ( is_wp_error( $response ) ) {
            return false;
        }

        $status_code = wp_remote_retrieve_response_code( $response );
        if ( 200 !== $status_code ) {
            return false;
        }

        $body = wp_remote_retrieve_body( $response );
        $data = json_decode( $body, true );

        if ( ! $data ) {
            return false;
        }

        // Support both direct PEM key and JWKS-style response.
        $pem_key = null;
        if ( isset( $data['public_key'] ) ) {
            $pem_key = $data['public_key'];
        } elseif ( isset( $data['keys'] ) && is_array( $data['keys'] ) ) {
            // Use the first RS256 key found.
            foreach ( $data['keys'] as $key ) {
                if ( isset( $key['alg'] ) && 'RS256' === $key['alg'] && isset( $key['pem'] ) ) {
                    $pem_key = $key['pem'];
                    break;
                }
            }
        }

        if ( empty( $pem_key ) ) {
            return false;
        }

        set_transient( self::PUBLIC_KEY_TRANSIENT, $pem_key, self::PUBLIC_KEY_CACHE_TTL );

        return $pem_key;
    }

    /**
     * Verify an agent certificate (JWT token).
     *
     * Manually decodes the JWT (base64url decode header.payload.signature),
     * verifies the RS256 signature using openssl_verify() with the Station
     * public key, and validates claims (exp, iss).
     *
     * @param string $token The JWT token to verify.
     * @return array|false The decoded payload as an associative array, or false on failure.
     */
    public function verify_certificate( $token ) {
        if ( empty( $token ) ) {
            return false;
        }

        // Split the JWT into its three parts.
        $parts = explode( '.', $token );
        if ( 3 !== count( $parts ) ) {
            return false;
        }

        list( $header_b64, $payload_b64, $signature_b64 ) = $parts;

        // Decode header.
        $header_json = $this->base64url_decode( $header_b64 );
        if ( false === $header_json ) {
            return false;
        }
        $header = json_decode( $header_json, true );
        if ( ! $header || ! isset( $header['alg'] ) ) {
            return false;
        }

        // Only accept RS256.
        if ( 'RS256' !== $header['alg'] ) {
            return false;
        }

        // Decode payload.
        $payload_json = $this->base64url_decode( $payload_b64 );
        if ( false === $payload_json ) {
            return false;
        }
        $payload = json_decode( $payload_json, true );
        if ( ! $payload ) {
            return false;
        }

        // Decode signature.
        $signature = $this->base64url_decode( $signature_b64 );
        if ( false === $signature ) {
            return false;
        }

        // Get the public key.
        $public_key_pem = $this->get_public_key();
        if ( false === $public_key_pem ) {
            return false;
        }

        // Verify the RS256 signature.
        $public_key = openssl_pkey_get_public( $public_key_pem );
        if ( false === $public_key ) {
            return false;
        }

        $data_to_verify = $header_b64 . '.' . $payload_b64;
        $verified = openssl_verify( $data_to_verify, $signature, $public_key, OPENSSL_ALGO_SHA256 );

        if ( 1 !== $verified ) {
            // Signature verification failed. Try refreshing the public key once.
            $public_key_pem = $this->get_public_key( true );
            if ( false === $public_key_pem ) {
                return false;
            }

            $public_key = openssl_pkey_get_public( $public_key_pem );
            if ( false === $public_key ) {
                return false;
            }

            $verified = openssl_verify( $data_to_verify, $signature, $public_key, OPENSSL_ALGO_SHA256 );
            if ( 1 !== $verified ) {
                return false;
            }
        }

        // Validate expiration claim.
        if ( isset( $payload['exp'] ) && $payload['exp'] <= time() ) {
            return false;
        }

        // Validate issuer claim.
        if ( ! isset( $payload['iss'] ) || 'agent-trust-station' !== $payload['iss'] ) {
            return false;
        }

        return $payload;
    }

    /**
     * Submit a usage report to the Station.
     *
     * Sends a POST request to {station_url}/reports with API key authentication.
     * This is fire-and-forget; errors are logged but do not affect the response.
     *
     * @param array $report The report data to submit.
     * @return bool True if the request was sent, false on immediate failure.
     */
    public function submit_report( $report ) {
        if ( empty( $this->station_url ) || empty( $this->api_key ) ) {
            return false;
        }

        $response = wp_remote_post(
            $this->station_url . '/reports',
            array(
                'timeout'  => 5,
                'blocking' => false,
                'headers'  => array(
                    'Content-Type'  => 'application/json',
                    'Authorization' => 'Bearer ' . $this->api_key,
                ),
                'body'     => wp_json_encode( $report ),
            )
        );

        if ( is_wp_error( $response ) ) {
            if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
                error_log( 'AgentTrust: Failed to submit report - ' . $response->get_error_message() );
            }
            return false;
        }

        return true;
    }

    /**
     * Test the connection to the Station.
     *
     * @return array Connection status with 'connected' boolean and 'message' string.
     */
    public function test_connection() {
        if ( empty( $this->station_url ) ) {
            return array(
                'connected' => false,
                'message'   => 'Station URL is not configured.',
            );
        }

        $key = $this->get_public_key( true );

        if ( false === $key ) {
            return array(
                'connected' => false,
                'message'   => 'Could not retrieve public key from Station.',
            );
        }

        return array(
            'connected' => true,
            'message'   => 'Successfully connected to AgentTrust Station.',
        );
    }

    /**
     * Decode a base64url-encoded string.
     *
     * @param string $input The base64url-encoded string.
     * @return string|false The decoded string, or false on failure.
     */
    private function base64url_decode( $input ) {
        $remainder = strlen( $input ) % 4;
        if ( $remainder ) {
            $input .= str_repeat( '=', 4 - $remainder );
        }
        $decoded = base64_decode( strtr( $input, '-_', '+/' ), true );
        return $decoded;
    }
}
