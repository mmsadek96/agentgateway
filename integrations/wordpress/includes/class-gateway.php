<?php
/**
 * AgentTrust Gateway
 *
 * Core gateway logic that defines available actions, handles execution,
 * and processes agent requests with trust verification.
 *
 * @package AgentTrust_Gateway
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class AgentTrust_Gateway {

    /**
     * The Station client instance.
     *
     * @var AgentTrust_Station_Client
     */
    private $station_client;

    /**
     * The gateway identifier.
     *
     * @var string
     */
    private $gateway_id;

    /**
     * Constructor.
     *
     * @param AgentTrust_Station_Client $station_client The Station client.
     * @param string                    $gateway_id     The unique gateway ID.
     */
    public function __construct( AgentTrust_Station_Client $station_client, $gateway_id ) {
        $this->station_client = $station_client;
        $this->gateway_id     = $gateway_id;
    }

    /**
     * Get the list of available actions this gateway exposes.
     *
     * Each action includes a description, minimum trust score required,
     * and parameter definitions.
     *
     * @return array Associative array of action definitions keyed by action name.
     */
    public function get_actions() {
        $actions = array(
            'search_posts'   => array(
                'description' => 'Search WordPress posts by keyword.',
                'minScore'    => 20,
                'parameters'  => array(
                    'query'    => array(
                        'type'        => 'string',
                        'required'    => true,
                        'description' => 'The search query string.',
                    ),
                    'per_page' => array(
                        'type'        => 'integer',
                        'required'    => false,
                        'description' => 'Number of results per page (default: 10, max: 50).',
                        'default'     => 10,
                    ),
                    'page'     => array(
                        'type'        => 'integer',
                        'required'    => false,
                        'description' => 'Page number for pagination.',
                        'default'     => 1,
                    ),
                ),
            ),
            'get_post'       => array(
                'description' => 'Get a single WordPress post by ID.',
                'minScore'    => 30,
                'parameters'  => array(
                    'post_id' => array(
                        'type'        => 'integer',
                        'required'    => true,
                        'description' => 'The WordPress post ID.',
                    ),
                ),
            ),
            'get_categories' => array(
                'description' => 'Get the list of post categories.',
                'minScore'    => 20,
                'parameters'  => array(
                    'hide_empty' => array(
                        'type'        => 'boolean',
                        'required'    => false,
                        'description' => 'Whether to hide categories with no posts.',
                        'default'     => true,
                    ),
                ),
            ),
            'submit_comment' => array(
                'description' => 'Submit a comment on a post. Requires higher trust score.',
                'minScore'    => 50,
                'parameters'  => array(
                    'post_id'      => array(
                        'type'        => 'integer',
                        'required'    => true,
                        'description' => 'The post ID to comment on.',
                    ),
                    'content'      => array(
                        'type'        => 'string',
                        'required'    => true,
                        'description' => 'The comment content.',
                    ),
                    'author_name'  => array(
                        'type'        => 'string',
                        'required'    => true,
                        'description' => 'The comment author name.',
                    ),
                    'author_email' => array(
                        'type'        => 'string',
                        'required'    => true,
                        'description' => 'The comment author email address.',
                    ),
                ),
            ),
        );

        // Add WooCommerce actions if WooCommerce is active.
        if ( $this->is_woocommerce_active() ) {
            $actions['get_products'] = array(
                'description' => 'Search and list WooCommerce products.',
                'minScore'    => 30,
                'parameters'  => array(
                    'search'   => array(
                        'type'        => 'string',
                        'required'    => false,
                        'description' => 'Search term for products.',
                    ),
                    'category' => array(
                        'type'        => 'string',
                        'required'    => false,
                        'description' => 'Product category slug.',
                    ),
                    'per_page' => array(
                        'type'        => 'integer',
                        'required'    => false,
                        'description' => 'Number of results per page (default: 10, max: 50).',
                        'default'     => 10,
                    ),
                ),
            );

            $actions['create_order'] = array(
                'description' => 'Create a new WooCommerce order. Requires high trust score.',
                'minScore'    => 70,
                'parameters'  => array(
                    'products'       => array(
                        'type'        => 'array',
                        'required'    => true,
                        'description' => 'Array of products with product_id and quantity.',
                    ),
                    'billing_email'  => array(
                        'type'        => 'string',
                        'required'    => true,
                        'description' => 'Billing email address for the order.',
                    ),
                    'billing_name'   => array(
                        'type'        => 'string',
                        'required'    => true,
                        'description' => 'Billing name for the order.',
                    ),
                    'payment_method' => array(
                        'type'        => 'string',
                        'required'    => false,
                        'description' => 'Payment method ID.',
                        'default'     => '',
                    ),
                ),
            );
        }

        /**
         * Filter the available gateway actions.
         *
         * Allows other plugins or themes to add, modify, or remove
         * actions from the gateway.
         *
         * @param array $actions The array of action definitions.
         */
        return apply_filters( 'agenttrust_gateway_actions', $actions );
    }

    /**
     * Execute a specific action.
     *
     * @param string $action_name  The name of the action to execute.
     * @param array  $params       The parameters for the action.
     * @param array  $agent_context The decoded JWT payload with agent info.
     * @return array|WP_Error The action result, or WP_Error on failure.
     */
    public function execute_action( $action_name, $params, $agent_context ) {
        /**
         * Fires before an action is executed.
         *
         * @param string $action_name  The action name.
         * @param array  $params       The action parameters.
         * @param array  $agent_context The agent context from the JWT.
         */
        do_action( 'agenttrust_before_action', $action_name, $params, $agent_context );

        $result = null;

        switch ( $action_name ) {
            case 'search_posts':
                $result = $this->action_search_posts( $params );
                break;

            case 'get_post':
                $result = $this->action_get_post( $params );
                break;

            case 'get_categories':
                $result = $this->action_get_categories( $params );
                break;

            case 'submit_comment':
                $result = $this->action_submit_comment( $params, $agent_context );
                break;

            case 'get_products':
                $result = $this->action_get_products( $params );
                break;

            case 'create_order':
                $result = $this->action_create_order( $params, $agent_context );
                break;

            default:
                /**
                 * Filter to handle custom action execution.
                 *
                 * @param mixed  $result        The result (null if not handled).
                 * @param string $action_name   The action name.
                 * @param array  $params        The action parameters.
                 * @param array  $agent_context The agent context.
                 */
                $result = apply_filters( 'agenttrust_execute_custom_action', null, $action_name, $params, $agent_context );

                if ( null === $result ) {
                    return new WP_Error(
                        'unknown_action',
                        sprintf( 'Unknown action: %s', $action_name ),
                        array( 'status' => 404 )
                    );
                }
                break;
        }

        /**
         * Fires after an action is executed.
         *
         * @param string    $action_name  The action name.
         * @param mixed     $result       The action result.
         * @param array     $params       The action parameters.
         * @param array     $agent_context The agent context.
         */
        do_action( 'agenttrust_after_action', $action_name, $result, $params, $agent_context );

        return $result;
    }

    /**
     * Handle an incoming agent request.
     *
     * Extracts the certificate from the Authorization header, verifies it,
     * checks the trust score, executes the action, and submits a report.
     *
     * @param WP_REST_Request $request The REST API request.
     * @return array|WP_Error The action result, or WP_Error on failure.
     */
    public function handle_request( $request ) {
        $start_time = microtime( true );

        // Extract the certificate token from the Authorization header.
        $auth_header = $request->get_header( 'Authorization' );
        if ( empty( $auth_header ) ) {
            return new WP_Error(
                'missing_authorization',
                'Authorization header with agent certificate is required.',
                array( 'status' => 401 )
            );
        }

        // Support "Bearer <token>" format.
        $token = $auth_header;
        if ( 0 === strpos( $auth_header, 'Bearer ' ) ) {
            $token = substr( $auth_header, 7 );
        }

        // Verify the certificate.
        $agent_context = $this->station_client->verify_certificate( $token );
        if ( false === $agent_context ) {
            return new WP_Error(
                'invalid_certificate',
                'The agent certificate is invalid or expired.',
                array( 'status' => 403 )
            );
        }

        // Get the requested action.
        $action_name = $request->get_param( 'action_name' );
        $params      = $request->get_json_params();

        // Remove action_name from params if it was included in the body.
        unset( $params['action_name'] );

        // Check that the action exists.
        $actions = $this->get_actions();
        if ( ! isset( $actions[ $action_name ] ) ) {
            return new WP_Error(
                'unknown_action',
                sprintf( 'Unknown action: %s', $action_name ),
                array( 'status' => 404 )
            );
        }

        // Check the agent's trust score against the action's minimum.
        $action_def  = $actions[ $action_name ];
        $agent_score = isset( $agent_context['score'] ) ? (int) $agent_context['score'] : 0;
        $min_score   = isset( $action_def['minScore'] ) ? (int) $action_def['minScore'] : 0;

        if ( $agent_score < $min_score ) {
            return new WP_Error(
                'insufficient_trust_score',
                sprintf(
                    'Agent trust score %d is below the minimum %d required for action "%s".',
                    $agent_score,
                    $min_score,
                    $action_name
                ),
                array( 'status' => 403 )
            );
        }

        // Execute the action.
        $result = $this->execute_action( $action_name, $params, $agent_context );

        // Calculate duration.
        $duration_ms = round( ( microtime( true ) - $start_time ) * 1000 );

        // Build and submit the usage report.
        $success = ! is_wp_error( $result );
        $report  = array(
            'gateway_id'  => $this->gateway_id,
            'agent_id'    => isset( $agent_context['sub'] ) ? $agent_context['sub'] : 'unknown',
            'action'      => $action_name,
            'success'     => $success,
            'duration_ms' => $duration_ms,
            'score_used'  => $agent_score,
            'timestamp'   => gmdate( 'c' ),
        );

        if ( ! $success ) {
            $report['error'] = $result->get_error_message();
        }

        $this->station_client->submit_report( $report );

        // Issue Bot Shield access token on successful actions.
        if ( $success ) {
            $shield_secret = get_option( 'agenttrust_shield_secret', '' );
            if ( ! empty( $shield_secret ) ) {
                $shield       = new AgentTrust_Bot_Shield( $shield_secret, $this->gateway_id );
                $agent_id_val = isset( $agent_context['sub'] ) ? $agent_context['sub'] : 'unknown';
                $access_token = $shield->generate_access_token( $agent_id_val, $action_name );

                if ( is_array( $result ) ) {
                    $result['accessToken'] = $access_token;
                }
            }
        }

        return $result;
    }

    /**
     * Search posts by keyword.
     *
     * @param array $params Action parameters.
     * @return array Search results.
     */
    private function action_search_posts( $params ) {
        $query    = isset( $params['query'] ) ? sanitize_text_field( $params['query'] ) : '';
        $per_page = isset( $params['per_page'] ) ? min( absint( $params['per_page'] ), 50 ) : 10;
        $page     = isset( $params['page'] ) ? max( absint( $params['page'] ), 1 ) : 1;

        if ( empty( $query ) ) {
            return new WP_Error( 'missing_query', 'Search query is required.', array( 'status' => 400 ) );
        }

        $wp_query = new WP_Query( array(
            's'              => $query,
            'posts_per_page' => $per_page,
            'paged'          => $page,
            'post_status'    => 'publish',
            'post_type'      => 'post',
        ) );

        $posts = array();
        foreach ( $wp_query->posts as $post ) {
            $posts[] = $this->format_post( $post );
        }

        return array(
            'results'     => $posts,
            'total'       => $wp_query->found_posts,
            'total_pages' => $wp_query->max_num_pages,
            'page'        => $page,
        );
    }

    /**
     * Get a single post by ID.
     *
     * @param array $params Action parameters.
     * @return array|WP_Error Post data or error.
     */
    private function action_get_post( $params ) {
        $post_id = isset( $params['post_id'] ) ? absint( $params['post_id'] ) : 0;

        if ( ! $post_id ) {
            return new WP_Error( 'missing_post_id', 'Post ID is required.', array( 'status' => 400 ) );
        }

        $post = get_post( $post_id );

        if ( ! $post || 'publish' !== $post->post_status ) {
            return new WP_Error( 'not_found', 'Post not found.', array( 'status' => 404 ) );
        }

        return $this->format_post( $post, true );
    }

    /**
     * Get post categories.
     *
     * @param array $params Action parameters.
     * @return array List of categories.
     */
    private function action_get_categories( $params ) {
        $hide_empty = isset( $params['hide_empty'] ) ? (bool) $params['hide_empty'] : true;

        $categories = get_categories( array(
            'hide_empty' => $hide_empty,
            'orderby'    => 'name',
            'order'      => 'ASC',
        ) );

        $result = array();
        foreach ( $categories as $cat ) {
            $result[] = array(
                'id'          => $cat->term_id,
                'name'        => $cat->name,
                'slug'        => $cat->slug,
                'description' => $cat->description,
                'count'       => $cat->count,
                'parent'      => $cat->parent,
            );
        }

        return array( 'categories' => $result );
    }

    /**
     * Submit a comment on a post.
     *
     * @param array $params        Action parameters.
     * @param array $agent_context Agent context from JWT.
     * @return array|WP_Error Comment data or error.
     */
    private function action_submit_comment( $params, $agent_context ) {
        $post_id      = isset( $params['post_id'] ) ? absint( $params['post_id'] ) : 0;
        $content      = isset( $params['content'] ) ? sanitize_textarea_field( $params['content'] ) : '';
        $author_name  = isset( $params['author_name'] ) ? sanitize_text_field( $params['author_name'] ) : '';
        $author_email = isset( $params['author_email'] ) ? sanitize_email( $params['author_email'] ) : '';

        if ( ! $post_id || empty( $content ) || empty( $author_name ) || empty( $author_email ) ) {
            return new WP_Error(
                'missing_params',
                'post_id, content, author_name, and author_email are required.',
                array( 'status' => 400 )
            );
        }

        $post = get_post( $post_id );
        if ( ! $post || 'publish' !== $post->post_status ) {
            return new WP_Error( 'not_found', 'Post not found.', array( 'status' => 404 ) );
        }

        if ( ! comments_open( $post_id ) ) {
            return new WP_Error( 'comments_closed', 'Comments are closed for this post.', array( 'status' => 403 ) );
        }

        $agent_id = isset( $agent_context['sub'] ) ? $agent_context['sub'] : 'unknown-agent';

        $comment_data = array(
            'comment_post_ID'      => $post_id,
            'comment_content'      => $content,
            'comment_author'       => $author_name . ' (via AgentTrust:' . $agent_id . ')',
            'comment_author_email' => $author_email,
            'comment_type'         => 'comment',
            'comment_approved'     => 0, // Hold for moderation by default.
            'comment_meta'         => array(
                'agenttrust_agent_id' => $agent_id,
                'agenttrust_score'    => isset( $agent_context['score'] ) ? $agent_context['score'] : 0,
            ),
        );

        /**
         * Filter the comment data before insertion.
         *
         * @param array $comment_data The comment data.
         * @param array $agent_context The agent context.
         */
        $comment_data = apply_filters( 'agenttrust_comment_data', $comment_data, $agent_context );

        $comment_id = wp_insert_comment( $comment_data );

        if ( ! $comment_id ) {
            return new WP_Error( 'comment_failed', 'Failed to insert comment.', array( 'status' => 500 ) );
        }

        return array(
            'comment_id' => $comment_id,
            'status'     => 'held_for_moderation',
            'message'    => 'Comment submitted and held for moderation.',
        );
    }

    /**
     * Get WooCommerce products.
     *
     * @param array $params Action parameters.
     * @return array|WP_Error Product list or error.
     */
    private function action_get_products( $params ) {
        if ( ! $this->is_woocommerce_active() ) {
            return new WP_Error( 'woocommerce_inactive', 'WooCommerce is not active.', array( 'status' => 501 ) );
        }

        $args = array(
            'status' => 'publish',
            'limit'  => isset( $params['per_page'] ) ? min( absint( $params['per_page'] ), 50 ) : 10,
        );

        if ( ! empty( $params['search'] ) ) {
            $args['s'] = sanitize_text_field( $params['search'] );
        }

        if ( ! empty( $params['category'] ) ) {
            $args['category'] = array( sanitize_text_field( $params['category'] ) );
        }

        $query    = new WC_Product_Query( $args );
        $products = $query->get_products();

        $result = array();
        foreach ( $products as $product ) {
            $result[] = array(
                'id'          => $product->get_id(),
                'name'        => $product->get_name(),
                'slug'        => $product->get_slug(),
                'price'       => $product->get_price(),
                'regular_price' => $product->get_regular_price(),
                'sale_price'  => $product->get_sale_price(),
                'description' => wp_trim_words( $product->get_description(), 50 ),
                'short_description' => $product->get_short_description(),
                'sku'         => $product->get_sku(),
                'stock_status' => $product->get_stock_status(),
                'categories'  => wp_list_pluck( $product->get_category_ids(), 'term_id' ),
                'permalink'   => $product->get_permalink(),
            );
        }

        return array( 'products' => $result );
    }

    /**
     * Create a WooCommerce order.
     *
     * @param array $params        Action parameters.
     * @param array $agent_context Agent context from JWT.
     * @return array|WP_Error Order data or error.
     */
    private function action_create_order( $params, $agent_context ) {
        if ( ! $this->is_woocommerce_active() ) {
            return new WP_Error( 'woocommerce_inactive', 'WooCommerce is not active.', array( 'status' => 501 ) );
        }

        $products      = isset( $params['products'] ) ? $params['products'] : array();
        $billing_email = isset( $params['billing_email'] ) ? sanitize_email( $params['billing_email'] ) : '';
        $billing_name  = isset( $params['billing_name'] ) ? sanitize_text_field( $params['billing_name'] ) : '';

        if ( empty( $products ) || empty( $billing_email ) || empty( $billing_name ) ) {
            return new WP_Error(
                'missing_params',
                'products, billing_email, and billing_name are required.',
                array( 'status' => 400 )
            );
        }

        $order = wc_create_order();

        if ( is_wp_error( $order ) ) {
            return $order;
        }

        // Add products to the order.
        foreach ( $products as $item ) {
            $product_id = isset( $item['product_id'] ) ? absint( $item['product_id'] ) : 0;
            $quantity   = isset( $item['quantity'] ) ? max( absint( $item['quantity'] ), 1 ) : 1;

            $product = wc_get_product( $product_id );
            if ( ! $product ) {
                $order->delete( true );
                return new WP_Error(
                    'invalid_product',
                    sprintf( 'Product ID %d not found.', $product_id ),
                    array( 'status' => 400 )
                );
            }

            $order->add_product( $product, $quantity );
        }

        // Set billing details.
        $name_parts = explode( ' ', $billing_name, 2 );
        $order->set_billing_first_name( $name_parts[0] );
        $order->set_billing_last_name( isset( $name_parts[1] ) ? $name_parts[1] : '' );
        $order->set_billing_email( $billing_email );

        if ( ! empty( $params['payment_method'] ) ) {
            $order->set_payment_method( sanitize_text_field( $params['payment_method'] ) );
        }

        // Add metadata to track agent-created orders.
        $agent_id = isset( $agent_context['sub'] ) ? $agent_context['sub'] : 'unknown-agent';
        $order->update_meta_data( '_agenttrust_agent_id', $agent_id );
        $order->update_meta_data( '_agenttrust_score', isset( $agent_context['score'] ) ? $agent_context['score'] : 0 );

        $order->calculate_totals();
        $order->set_status( 'pending' );
        $order->save();

        return array(
            'order_id'  => $order->get_id(),
            'status'    => $order->get_status(),
            'total'     => $order->get_total(),
            'currency'  => $order->get_currency(),
            'message'   => 'Order created successfully.',
        );
    }

    /**
     * Format a WordPress post for API output.
     *
     * @param WP_Post $post         The post object.
     * @param bool    $full_content Whether to include the full content.
     * @return array Formatted post data.
     */
    private function format_post( $post, $full_content = false ) {
        $data = array(
            'id'         => $post->ID,
            'title'      => get_the_title( $post ),
            'slug'       => $post->post_name,
            'excerpt'    => get_the_excerpt( $post ),
            'date'       => $post->post_date_gmt,
            'modified'   => $post->post_modified_gmt,
            'author'     => get_the_author_meta( 'display_name', $post->post_author ),
            'categories' => wp_get_post_categories( $post->ID, array( 'fields' => 'names' ) ),
            'tags'       => wp_get_post_tags( $post->ID, array( 'fields' => 'names' ) ),
            'permalink'  => get_permalink( $post ),
        );

        if ( $full_content ) {
            $data['content'] = apply_filters( 'the_content', $post->post_content );
        }

        if ( has_post_thumbnail( $post ) ) {
            $data['featured_image'] = get_the_post_thumbnail_url( $post, 'full' );
        }

        return $data;
    }

    /**
     * Check if WooCommerce is active.
     *
     * @return bool True if WooCommerce is active.
     */
    private function is_woocommerce_active() {
        return class_exists( 'WooCommerce' );
    }

    /**
     * Get the gateway ID.
     *
     * @return string The gateway ID.
     */
    public function get_gateway_id() {
        return $this->gateway_id;
    }
}
