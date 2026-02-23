<?php
/**
 * AgentTrust REST API
 *
 * Registers and handles the WordPress REST API routes for the
 * AgentTrust Gateway, including discovery and action execution endpoints.
 *
 * @package AgentTrust_Gateway
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class AgentTrust_REST_API {

    /**
     * The REST API namespace.
     *
     * @var string
     */
    const NAMESPACE = 'agenttrust/v1';

    /**
     * The Gateway instance.
     *
     * @var AgentTrust_Gateway
     */
    private $gateway;

    /**
     * Constructor.
     *
     * @param AgentTrust_Gateway $gateway The Gateway instance.
     */
    public function __construct( AgentTrust_Gateway $gateway ) {
        $this->gateway = $gateway;
    }

    /**
     * Register REST API routes.
     *
     * Registers the following endpoints under the 'agenttrust/v1' namespace:
     * - GET /discovery            : Public discovery of available actions
     * - GET /.well-known/agent-gateway : Alias for discovery
     * - POST /actions/<action_name>    : Execute an action (requires agent certificate)
     */
    public function register_routes() {
        // Discovery endpoint.
        register_rest_route( self::NAMESPACE, '/discovery', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array( $this, 'handle_discovery' ),
            'permission_callback' => '__return_true',
        ) );

        // Well-known alias for discovery.
        register_rest_route( self::NAMESPACE, '/.well-known/agent-gateway', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array( $this, 'handle_discovery' ),
            'permission_callback' => '__return_true',
        ) );

        // Action execution endpoint.
        register_rest_route( self::NAMESPACE, '/actions/(?P<action_name>[a-zA-Z0-9_-]+)', array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => array( $this, 'handle_action' ),
            'permission_callback' => '__return_true', // Auth is handled via agent certificate in the callback.
            'args'                => array(
                'action_name' => array(
                    'required'          => true,
                    'validate_callback' => function ( $param ) {
                        return preg_match( '/^[a-zA-Z0-9_-]+$/', $param );
                    },
                    'sanitize_callback' => 'sanitize_text_field',
                ),
            ),
        ) );
    }

    /**
     * Handle the discovery endpoint.
     *
     * Returns the gateway ID, protocol version, and the list of available
     * actions with their descriptions, minimum score requirements, and parameters.
     * This endpoint is public and requires no authentication.
     *
     * @param WP_REST_Request $request The REST request.
     * @return WP_REST_Response The discovery response.
     */
    public function handle_discovery( $request ) {
        $actions     = $this->gateway->get_actions();
        $gateway_id  = $this->gateway->get_gateway_id();
        $site_name   = get_bloginfo( 'name' );
        $site_url    = home_url();

        // Build the discovery payload.
        $discovery = array(
            'gateway_id'   => $gateway_id,
            'protocol'     => 'agenttrust/v1',
            'site_name'    => $site_name,
            'site_url'     => $site_url,
            'description'  => sprintf(
                'AgentTrust Gateway for %s. Verify your agent certificate to interact with this site.',
                $site_name
            ),
            'actions'      => array(),
            'auth'         => array(
                'type'        => 'bearer',
                'description' => 'Include your AgentTrust certificate as a Bearer token in the Authorization header.',
                'header'      => 'Authorization: Bearer <agent-certificate-jwt>',
            ),
            'endpoints'    => array(
                'discovery' => rest_url( self::NAMESPACE . '/discovery' ),
                'actions'   => rest_url( self::NAMESPACE . '/actions/{action_name}' ),
            ),
        );

        // Format actions for the discovery response.
        foreach ( $actions as $name => $action ) {
            $discovery['actions'][ $name ] = array(
                'description' => $action['description'],
                'minScore'    => $action['minScore'],
                'parameters'  => $action['parameters'],
                'endpoint'    => rest_url( self::NAMESPACE . '/actions/' . $name ),
                'method'      => 'POST',
            );
        }

        /**
         * Filter the discovery response before returning.
         *
         * @param array           $discovery The discovery payload.
         * @param WP_REST_Request $request   The REST request.
         */
        $discovery = apply_filters( 'agenttrust_discovery_response', $discovery, $request );

        $response = new WP_REST_Response( $discovery, 200 );

        // Add CORS headers for agent access.
        $response->header( 'Access-Control-Allow-Origin', '*' );
        $response->header( 'Access-Control-Allow-Headers', 'Authorization, Content-Type' );

        return $response;
    }

    /**
     * Handle the action execution endpoint.
     *
     * Extracts the action name from the URL, parameters from the request body,
     * and delegates to the Gateway's handle_request method for certificate
     * verification and action execution.
     *
     * @param WP_REST_Request $request The REST request.
     * @return WP_REST_Response|WP_Error The action result or error.
     */
    public function handle_action( $request ) {
        $result = $this->gateway->handle_request( $request );

        if ( is_wp_error( $result ) ) {
            $status = $result->get_error_data();
            $code   = isset( $status['status'] ) ? $status['status'] : 500;

            $response = new WP_REST_Response(
                array(
                    'error'   => $result->get_error_code(),
                    'message' => $result->get_error_message(),
                ),
                $code
            );
        } else {
            $response = new WP_REST_Response(
                array(
                    'success' => true,
                    'data'    => $result,
                ),
                200
            );
        }

        // Add CORS headers for agent access.
        $response->header( 'Access-Control-Allow-Origin', '*' );
        $response->header( 'Access-Control-Allow-Headers', 'Authorization, Content-Type' );

        return $response;
    }
}
