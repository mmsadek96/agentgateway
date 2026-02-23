<?php
/**
 * AgentTrust Admin Settings
 *
 * Handles the WordPress admin settings page registration,
 * rendering, and field management for the AgentTrust Gateway plugin.
 *
 * @package AgentTrust_Gateway
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class AgentTrust_Admin_Settings {

    /**
     * The Station client instance for testing connections.
     *
     * @var AgentTrust_Station_Client
     */
    private $station_client;

    /**
     * Constructor.
     *
     * @param AgentTrust_Station_Client $station_client The Station client.
     */
    public function __construct( AgentTrust_Station_Client $station_client ) {
        $this->station_client = $station_client;
    }

    /**
     * Register the plugin settings, sections, and fields.
     */
    public function register_settings() {
        // Register settings.
        register_setting( 'agenttrust_settings', 'agenttrust_station_url', array(
            'type'              => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default'           => 'https://station.agenttrust.org',
        ) );

        register_setting( 'agenttrust_settings', 'agenttrust_api_key', array(
            'type'              => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default'           => '',
        ) );

        register_setting( 'agenttrust_settings', 'agenttrust_gateway_id', array(
            'type'              => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default'           => '',
        ) );

        register_setting( 'agenttrust_settings', 'agenttrust_min_score_default', array(
            'type'              => 'integer',
            'sanitize_callback' => 'absint',
            'default'           => 30,
        ) );

        // Add settings section.
        add_settings_section(
            'agenttrust_main_section',
            __( 'Gateway Configuration', 'agenttrust-gateway' ),
            array( $this, 'render_section_description' ),
            'agenttrust-settings'
        );

        // Add settings fields.
        add_settings_field(
            'agenttrust_station_url',
            __( 'Station URL', 'agenttrust-gateway' ),
            array( $this, 'render_station_url_field' ),
            'agenttrust-settings',
            'agenttrust_main_section'
        );

        add_settings_field(
            'agenttrust_api_key',
            __( 'API Key', 'agenttrust-gateway' ),
            array( $this, 'render_api_key_field' ),
            'agenttrust-settings',
            'agenttrust_main_section'
        );

        add_settings_field(
            'agenttrust_gateway_id',
            __( 'Gateway ID', 'agenttrust-gateway' ),
            array( $this, 'render_gateway_id_field' ),
            'agenttrust-settings',
            'agenttrust_main_section'
        );

        add_settings_field(
            'agenttrust_min_score_default',
            __( 'Default Minimum Score', 'agenttrust-gateway' ),
            array( $this, 'render_min_score_field' ),
            'agenttrust-settings',
            'agenttrust_main_section'
        );
    }

    /**
     * Add the AgentTrust settings page under the Settings menu.
     */
    public function add_menu_page() {
        $hook = add_options_page(
            __( 'AgentTrust Gateway Settings', 'agenttrust-gateway' ),
            __( 'AgentTrust', 'agenttrust-gateway' ),
            'manage_options',
            'agenttrust-settings',
            array( $this, 'render_settings_page' )
        );

        // Enqueue admin styles on the settings page.
        add_action( 'admin_print_styles-' . $hook, array( $this, 'enqueue_admin_styles' ) );
    }

    /**
     * Enqueue the admin CSS stylesheet.
     */
    public function enqueue_admin_styles() {
        wp_enqueue_style(
            'agenttrust-admin',
            AGENTTRUST_PLUGIN_URL . 'admin/admin.css',
            array(),
            AGENTTRUST_VERSION
        );
    }

    /**
     * Render the settings page by including the admin template.
     */
    public function render_settings_page() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }

        $station_client = $this->station_client;
        include AGENTTRUST_PLUGIN_DIR . 'admin/settings-page.php';
    }

    /**
     * Render the section description.
     */
    public function render_section_description() {
        echo '<p>' . esc_html__(
            'Configure the connection to your AgentTrust Station. Agents will use these settings to verify their identity and interact with your site.',
            'agenttrust-gateway'
        ) . '</p>';
    }

    /**
     * Render the Station URL field.
     */
    public function render_station_url_field() {
        $value = get_option( 'agenttrust_station_url', 'https://station.agenttrust.org' );
        printf(
            '<input type="url" id="agenttrust_station_url" name="agenttrust_station_url" value="%s" class="regular-text" placeholder="https://station.agenttrust.org" />',
            esc_attr( $value )
        );
        echo '<p class="description">' . esc_html__( 'The URL of your AgentTrust Station instance.', 'agenttrust-gateway' ) . '</p>';
    }

    /**
     * Render the API Key field.
     */
    public function render_api_key_field() {
        $value = get_option( 'agenttrust_api_key', '' );
        printf(
            '<input type="password" id="agenttrust_api_key" name="agenttrust_api_key" value="%s" class="regular-text" autocomplete="off" />',
            esc_attr( $value )
        );
        echo '<p class="description">' . esc_html__( 'Your API key for authenticating with the AgentTrust Station. Used for submitting reports.', 'agenttrust-gateway' ) . '</p>';
    }

    /**
     * Render the Gateway ID field.
     */
    public function render_gateway_id_field() {
        $value = get_option( 'agenttrust_gateway_id', '' );
        printf(
            '<input type="text" id="agenttrust_gateway_id" name="agenttrust_gateway_id" value="%s" class="regular-text" />',
            esc_attr( $value )
        );
        echo '<p class="description">' . esc_html__( 'A unique identifier for this gateway instance. Auto-generated on activation.', 'agenttrust-gateway' ) . '</p>';
    }

    /**
     * Render the default minimum score field.
     */
    public function render_min_score_field() {
        $value = get_option( 'agenttrust_min_score_default', 30 );
        printf(
            '<input type="number" id="agenttrust_min_score_default" name="agenttrust_min_score_default" value="%d" min="0" max="100" class="small-text" />',
            absint( $value )
        );
        echo '<p class="description">' . esc_html__( 'Default minimum trust score required for actions (0-100). Individual actions may override this.', 'agenttrust-gateway' ) . '</p>';
    }

    /**
     * AJAX handler for testing the Station connection.
     * Registered separately if needed.
     *
     * @return array Connection test result.
     */
    public function test_connection() {
        return $this->station_client->test_connection();
    }
}
