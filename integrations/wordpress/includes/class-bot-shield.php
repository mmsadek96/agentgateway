<?php
/**
 * AgentTrust Bot Shield — blocks direct bot access to WordPress sites.
 *
 * Verifies that non-browser requests carry a valid HMAC-SHA256 access token
 * issued by the AgentTrust gateway after a successful action execution.
 *
 * Browser users are detected via User-Agent heuristics and allowed through.
 * Bots without a valid gateway token receive a 403 JSON response.
 *
 * @package AgentTrust_Gateway
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class AgentTrust_Bot_Shield {

    /** @var string HMAC-SHA256 shared secret */
    private $secret;

    /** @var string Gateway ID to restrict tokens to */
    private $gateway_id;

    /** @var array Configuration options */
    private $config;

    /**
     * @param string $secret     Shared HMAC-SHA256 secret (must match gateway's shield secret)
     * @param string $gateway_id Optional gateway ID to restrict accepted tokens
     * @param array  $config     Optional configuration overrides
     */
    public function __construct( $secret, $gateway_id = '', $config = array() ) {
        $this->secret     = $secret;
        $this->gateway_id = $gateway_id;
        $this->config     = wp_parse_args( $config, array(
            'allow_browsers'  => true,
            'max_token_age'   => 60,
            'enforce_nonce'   => true,
            'exclude_paths'   => array( '/wp-admin', '/wp-login.php', '/wp-cron.php', '/wp-json/agenttrust' ),
        ) );
    }

    // ─── WordPress Hook Registration ───

    /**
     * Register WordPress hooks for bot protection.
     * Call this during plugin init.
     */
    public function register_hooks() {
        // Protect REST API routes (outside the agenttrust namespace)
        add_filter( 'rest_pre_dispatch', array( $this, 'filter_rest_pre_dispatch' ), 5, 3 );

        // Protect frontend page requests
        add_action( 'template_redirect', array( $this, 'check_frontend_request' ), 1 );
    }

    // ─── REST API Filter ───

    /**
     * Filter REST API requests — block bots without gateway tokens.
     *
     * @param mixed            $result  Pre-dispatch result (pass through if null).
     * @param \WP_REST_Server  $server  Server instance.
     * @param \WP_REST_Request $request Request instance.
     * @return mixed|WP_Error
     */
    public function filter_rest_pre_dispatch( $result, $server, $request ) {
        // Don't interfere if already handled
        if ( null !== $result ) {
            return $result;
        }

        $route = $request->get_route();

        // Skip excluded paths (e.g., /wp-json/agenttrust/* — gateway endpoints)
        if ( $this->is_excluded_path( $route ) ) {
            return $result;
        }

        // Allow browsers through
        if ( $this->config['allow_browsers'] && $this->is_browser() ) {
            return $result;
        }

        // Check for access token
        $token = $this->get_token_from_request();

        if ( empty( $token ) ) {
            return new WP_Error(
                'bot_shield_no_token',
                'Bot access to this website requires authentication through the AgentTrust gateway.',
                array(
                    'status'  => 403,
                    'gateway' => '/.well-known/agent-gateway',
                    'hint'    => 'Execute an action via the gateway to receive an access token',
                )
            );
        }

        // Verify the token
        $payload = $this->verify_access_token( $token );

        if ( false === $payload ) {
            return new WP_Error(
                'bot_shield_invalid_token',
                'Invalid or expired gateway access token.',
                array( 'status' => 403 )
            );
        }

        return $result;
    }

    // ─── Frontend Protection ───

    /**
     * Check frontend (non-REST) requests.
     * Blocks bot-like requests that don't have a gateway token.
     */
    public function check_frontend_request() {
        // Skip admin, login, and cron pages
        if ( is_admin() || $this->is_excluded_path( $_SERVER['REQUEST_URI'] ?? '' ) ) {
            return;
        }

        // Allow browsers through
        if ( $this->config['allow_browsers'] && $this->is_browser() ) {
            return;
        }

        // Check for access token
        $token = $this->get_token_from_request();

        if ( empty( $token ) ) {
            $this->send_blocked_response( 'No gateway access token provided' );
            return;
        }

        $payload = $this->verify_access_token( $token );

        if ( false === $payload ) {
            $this->send_blocked_response( 'Invalid or expired gateway access token' );
            return;
        }

        // Token is valid — request can proceed
    }

    // ─── Token Generation ───

    /**
     * Generate an HMAC-SHA256 access token.
     * Called by the gateway after successful action execution.
     *
     * @param string $agent_id  Agent's internal UUID.
     * @param string $action    The action that was executed.
     * @return string The access token string.
     */
    public function generate_access_token( $agent_id, $action ) {
        $now     = time();
        $payload = array(
            'agentId'   => $agent_id,
            'gatewayId' => $this->gateway_id,
            'action'    => $action,
            'iat'       => $now,
            'exp'       => $now + (int) $this->config['max_token_age'],
            'nonce'     => bin2hex( random_bytes( 16 ) ),
        );

        $payload_b64 = $this->base64url_encode( wp_json_encode( $payload ) );
        $signature   = hash_hmac( 'sha256', $payload_b64, $this->secret, true );
        $sig_b64     = $this->base64url_encode( $signature );

        return $payload_b64 . '.' . $sig_b64;
    }

    // ─── Token Verification ───

    /**
     * Verify an HMAC-SHA256 access token.
     *
     * @param string $token The access token string.
     * @return array|false Decoded payload on success, false on failure.
     */
    private function verify_access_token( $token ) {
        $parts = explode( '.', $token );
        if ( 2 !== count( $parts ) ) {
            return false;
        }

        list( $payload_b64, $sig_b64 ) = $parts;

        // Recompute HMAC and compare (timing-safe)
        $expected_sig = hash_hmac( 'sha256', $payload_b64, $this->secret, true );
        $actual_sig   = $this->base64url_decode( $sig_b64 );

        if ( false === $actual_sig || ! hash_equals( $expected_sig, $actual_sig ) ) {
            return false;
        }

        // Decode payload
        $payload_str = $this->base64url_decode( $payload_b64 );
        if ( false === $payload_str ) {
            return false;
        }

        $payload = json_decode( $payload_str, true );
        if ( ! is_array( $payload ) ) {
            return false;
        }

        // Check expiry
        if ( ! isset( $payload['exp'] ) || $payload['exp'] <= time() ) {
            return false;
        }

        // Check max token age
        if ( isset( $payload['iat'] ) && ( time() - $payload['iat'] ) > $this->config['max_token_age'] ) {
            return false;
        }

        // Check gateway ID
        if ( ! empty( $this->gateway_id ) && isset( $payload['gatewayId'] ) ) {
            if ( $payload['gatewayId'] !== $this->gateway_id ) {
                return false;
            }
        }

        // Nonce enforcement (prevent replay) using WP transients
        if ( $this->config['enforce_nonce'] && isset( $payload['nonce'] ) ) {
            $nonce_key = 'agenttrust_nonce_' . substr( $payload['nonce'], 0, 32 );

            if ( get_transient( $nonce_key ) ) {
                return false; // Already used
            }

            // Mark as used with TTL slightly longer than token age
            set_transient( $nonce_key, 1, $this->config['max_token_age'] + 10 );
        }

        return $payload;
    }

    // ─── Browser Detection ───

    /**
     * Heuristic-based browser detection.
     * Requires 2+ "browser signals" to classify as a browser.
     *
     * @return bool True if the request appears to come from a web browser.
     */
    private function is_browser() {
        $ua     = isset( $_SERVER['HTTP_USER_AGENT'] ) ? $_SERVER['HTTP_USER_AGENT'] : '';
        $accept = isset( $_SERVER['HTTP_ACCEPT'] ) ? $_SERVER['HTTP_ACCEPT'] : '';

        $signals = 0;

        // Signal 1: UA contains browser rendering engine
        if ( preg_match( '/Mozilla\/\d/', $ua ) && preg_match( '/AppleWebKit|Gecko/', $ua ) ) {
            $signals++;
        }

        // Signal 2: UA contains known browser name
        if ( preg_match( '/\b(Chrome|Firefox|Safari|Edge|Opera|Brave|Vivaldi)\b/', $ua ) ) {
            $signals++;
        }

        // Signal 3: Accepts HTML
        if ( false !== strpos( $accept, 'text/html' ) ) {
            $signals++;
        }

        // Signal 4: Fetch Metadata headers (modern browsers)
        if ( ! empty( $_SERVER['HTTP_SEC_FETCH_MODE'] ) || ! empty( $_SERVER['HTTP_SEC_FETCH_SITE'] ) ) {
            $signals++;
        }

        return $signals >= 2;
    }

    // ─── Helpers ───

    /**
     * Check if a path is excluded from Bot Shield protection.
     *
     * @param string $path The request path.
     * @return bool
     */
    private function is_excluded_path( $path ) {
        foreach ( $this->config['exclude_paths'] as $excluded ) {
            if ( $path === $excluded || 0 === strpos( $path, $excluded . '/' ) || 0 === strpos( $path, $excluded ) ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Extract the access token from the request.
     * Checks X-Gateway-Access-Token header.
     *
     * @return string|null
     */
    private function get_token_from_request() {
        // Check custom header
        if ( ! empty( $_SERVER['HTTP_X_GATEWAY_ACCESS_TOKEN'] ) ) {
            return sanitize_text_field( $_SERVER['HTTP_X_GATEWAY_ACCESS_TOKEN'] );
        }

        return null;
    }

    /**
     * Send a 403 JSON response for blocked requests.
     *
     * @param string $reason Human-readable reason.
     */
    private function send_blocked_response( $reason ) {
        status_header( 403 );
        header( 'Content-Type: application/json; charset=utf-8' );
        echo wp_json_encode( array(
            'error'   => 'Access denied',
            'reason'  => 'Bot access to this website requires authentication through the AgentTrust gateway',
            'gateway' => '/.well-known/agent-gateway',
            'hint'    => 'Execute an action via the gateway to receive an access token',
        ) );
        exit;
    }

    /**
     * Base64url encode.
     *
     * @param string $data Raw data.
     * @return string Base64url-encoded string.
     */
    private function base64url_encode( $data ) {
        return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' );
    }

    /**
     * Base64url decode.
     *
     * @param string $data Base64url-encoded string.
     * @return string|false Decoded data or false on failure.
     */
    private function base64url_decode( $data ) {
        $padded = str_pad( strtr( $data, '-_', '+/' ), strlen( $data ) % 4, '=', STR_PAD_RIGHT );
        return base64_decode( $padded, true );
    }
}
