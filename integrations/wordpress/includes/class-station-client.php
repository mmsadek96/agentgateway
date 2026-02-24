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

        // Support multiple Station response formats:
        // 1. Current Station format: { pem: "-----BEGIN PUBLIC KEY-----..." }
        // 2. Legacy format: { public_key: "..." }
        // 3. JWKS-style: { keys: [{ alg: "RS256", pem: "..." }] }
        $pem_key = null;
        if ( isset( $data['pem'] ) ) {
            $pem_key = $data['pem'];
        } elseif ( isset( $data['public_key'] ) ) {
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
        // SECURITY (#57): openssl_verify returns 1 on success, 0 on failure, -1 on error.
        // We must check strictly for === 1 and log OpenSSL errors when -1 is returned
        // so administrators can diagnose misconfigured certificates or missing extensions.
        $public_key = openssl_pkey_get_public( $public_key_pem );
        if ( false === $public_key ) {
            if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
                error_log( 'AgentTrust: Failed to parse public key - ' . openssl_error_string() );
            }
            return false;
        }

        $data_to_verify = $header_b64 . '.' . $payload_b64;
        $verified = openssl_verify( $data_to_verify, $signature, $public_key, OPENSSL_ALGO_SHA256 );

        if ( -1 === $verified ) {
            // OpenSSL internal error — log for debugging, don't expose to caller.
            if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
                error_log( 'AgentTrust: OpenSSL verify error - ' . openssl_error_string() );
            }
            return false;
        }

        if ( 1 !== $verified ) {
            // Signature verification failed. Try refreshing the public key once.
            $public_key_pem = $this->get_public_key( true );
            if ( false === $public_key_pem ) {
                return false;
            }

            $public_key = openssl_pkey_get_public( $public_key_pem );
            if ( false === $public_key ) {
                if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
                    error_log( 'AgentTrust: Failed to parse refreshed public key - ' . openssl_error_string() );
                }
                return false;
            }

            $verified = openssl_verify( $data_to_verify, $signature, $public_key, OPENSSL_ALGO_SHA256 );
            if ( -1 === $verified && defined( 'WP_DEBUG' ) && WP_DEBUG ) {
                error_log( 'AgentTrust: OpenSSL verify error (retry) - ' . openssl_error_string() );
            }
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

        // SECURITY (#67): Optional remote revocation check.
        // Without this, a revoked certificate remains usable until it expires.
        // Results are cached in a WP transient per JTI for the cert's remaining lifetime.
        if ( get_option( 'agenttrust_check_revocation', false ) && isset( $payload['jti'] ) ) {
            $revocation_result = $this->check_revocation( $token, $payload['jti'], $payload['exp'] );
            if ( false === $revocation_result ) {
                return false;
            }
        }

        return $payload;
    }

    /**
     * Check if a certificate has been revoked via the Station's verify endpoint.
     * Results are cached per JTI in a WP transient until the certificate expires.
     *
     * SECURITY (#67): Ensures revoked certificates are rejected even before expiry.
     *
     * @param string $token The JWT token to verify.
     * @param string $jti   The certificate's unique identifier.
     * @param int    $exp   The certificate's expiration timestamp.
     * @return bool True if the certificate is valid, false if revoked.
     */
    private function check_revocation( $token, $jti, $exp ) {
        $cache_key = 'agenttrust_revoke_' . substr( $jti, 0, 32 );
        $cached    = get_transient( $cache_key );

        if ( false !== $cached ) {
            return '1' === $cached;
        }

        // Ask the station if this certificate is still valid
        $response = wp_remote_get(
            $this->station_url . '/certificates/verify?token=' . urlencode( $token ),
            array(
                'timeout' => 5,
                'headers' => array( 'Accept' => 'application/json' ),
            )
        );

        if ( is_wp_error( $response ) ) {
            // Station unreachable — fail open to preserve availability
            return true;
        }

        $status = wp_remote_retrieve_response_code( $response );
        $body   = json_decode( wp_remote_retrieve_body( $response ), true );
        $valid  = ( 200 === $status && ! empty( $body['data']['valid'] ) );

        // Cache the result until the certificate expires (max 1 hour)
        $ttl = min( max( $exp - time(), 0 ), 3600 );
        set_transient( $cache_key, $valid ? '1' : '0', $ttl );

        return $valid;
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
