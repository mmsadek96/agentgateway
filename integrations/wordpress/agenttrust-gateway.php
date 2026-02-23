<?php
/**
 * Plugin Name: AgentTrust Gateway
 * Description: Add AI agent trust verification to your WordPress site. Agents interact with your content through a verified gateway with reputation scoring.
 * Version: 1.0.0
 * Author: AgentTrust
 * License: MIT
 * License URI: https://opensource.org/licenses/MIT
 * Text Domain: agenttrust-gateway
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'AGENTTRUST_VERSION', '1.0.0' );
define( 'AGENTTRUST_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'AGENTTRUST_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'AGENTTRUST_PLUGIN_BASENAME', plugin_basename( __FILE__ ) );

/**
 * Include required class files.
 */
require_once AGENTTRUST_PLUGIN_DIR . 'includes/class-station-client.php';
require_once AGENTTRUST_PLUGIN_DIR . 'includes/class-gateway.php';
require_once AGENTTRUST_PLUGIN_DIR . 'includes/class-admin-settings.php';
require_once AGENTTRUST_PLUGIN_DIR . 'includes/class-rest-api.php';

/**
 * Plugin activation hook.
 *
 * Sets default option values for the plugin configuration.
 */
function agenttrust_activate() {
    add_option( 'agenttrust_station_url', 'https://station.agenttrust.org' );
    add_option( 'agenttrust_api_key', '' );
    add_option( 'agenttrust_gateway_id', wp_generate_uuid4() );
    add_option( 'agenttrust_min_score_default', 30 );
}
register_activation_hook( __FILE__, 'agenttrust_activate' );

/**
 * Plugin deactivation hook.
 *
 * Cleans up transients and scheduled events.
 */
function agenttrust_deactivate() {
    delete_transient( 'agenttrust_station_public_key' );
    delete_transient( 'agenttrust_connection_status' );
}
register_deactivation_hook( __FILE__, 'agenttrust_deactivate' );

/**
 * Initialize the plugin.
 *
 * Creates the station client, gateway, admin settings, and REST API instances,
 * then registers all hooks.
 */
function agenttrust_init() {
    $station_url = get_option( 'agenttrust_station_url', '' );
    $api_key     = get_option( 'agenttrust_api_key', '' );
    $gateway_id  = get_option( 'agenttrust_gateway_id', '' );

    $station_client = new AgentTrust_Station_Client( $station_url, $api_key );
    $gateway        = new AgentTrust_Gateway( $station_client, $gateway_id );

    // Register admin settings.
    if ( is_admin() ) {
        $admin_settings = new AgentTrust_Admin_Settings( $station_client );
        add_action( 'admin_init', array( $admin_settings, 'register_settings' ) );
        add_action( 'admin_menu', array( $admin_settings, 'add_menu_page' ) );
    }

    // Register REST API endpoints.
    $rest_api = new AgentTrust_REST_API( $gateway );
    add_action( 'rest_api_init', array( $rest_api, 'register_routes' ) );
}
add_action( 'plugins_loaded', 'agenttrust_init' );

/**
 * Add a settings link on the plugins list page.
 *
 * @param array $links Existing plugin action links.
 * @return array Modified plugin action links.
 */
function agenttrust_plugin_action_links( $links ) {
    $settings_link = sprintf(
        '<a href="%s">%s</a>',
        admin_url( 'options-general.php?page=agenttrust-settings' ),
        __( 'Settings', 'agenttrust-gateway' )
    );
    array_unshift( $links, $settings_link );
    return $links;
}
add_filter( 'plugin_action_links_' . AGENTTRUST_PLUGIN_BASENAME, 'agenttrust_plugin_action_links' );
