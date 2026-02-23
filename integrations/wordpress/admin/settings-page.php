<?php
/**
 * AgentTrust Gateway Admin Settings Page Template
 *
 * Renders the settings page in the WordPress admin dashboard.
 *
 * @package AgentTrust_Gateway
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// Test connection status.
$connection_status = $station_client->test_connection();

// Get the gateway instance to list actions.
$gateway_id  = get_option( 'agenttrust_gateway_id', '' );
$temp_gateway = new AgentTrust_Gateway( $station_client, $gateway_id );
$actions      = $temp_gateway->get_actions();

// Discovery URL.
$discovery_url = rest_url( 'agenttrust/v1/discovery' );
?>
<div class="wrap agenttrust-settings-wrap">
    <h1><?php echo esc_html( get_admin_page_title() ); ?></h1>

    <div class="agenttrust-status-banner">
        <h2><?php esc_html_e( 'Connection Status', 'agenttrust-gateway' ); ?></h2>
        <div class="agenttrust-status-indicator">
            <span class="agenttrust-status-dot <?php echo $connection_status['connected'] ? 'connected' : 'disconnected'; ?>"></span>
            <span class="agenttrust-status-text">
                <?php echo esc_html( $connection_status['message'] ); ?>
            </span>
        </div>
        <?php if ( $connection_status['connected'] ) : ?>
            <p class="agenttrust-discovery-url">
                <?php esc_html_e( 'Discovery endpoint:', 'agenttrust-gateway' ); ?>
                <code><?php echo esc_url( $discovery_url ); ?></code>
            </p>
        <?php endif; ?>
    </div>

    <form method="post" action="options.php">
        <?php
        settings_fields( 'agenttrust_settings' );
        do_settings_sections( 'agenttrust-settings' );
        submit_button( __( 'Save Settings', 'agenttrust-gateway' ) );
        ?>
    </form>

    <div class="agenttrust-actions-section">
        <h2><?php esc_html_e( 'Registered Actions', 'agenttrust-gateway' ); ?></h2>
        <p class="description">
            <?php esc_html_e( 'These are the actions available to verified AI agents. Each action requires a minimum trust score.', 'agenttrust-gateway' ); ?>
        </p>

        <table class="widefat agenttrust-actions-table">
            <thead>
                <tr>
                    <th><?php esc_html_e( 'Action', 'agenttrust-gateway' ); ?></th>
                    <th><?php esc_html_e( 'Description', 'agenttrust-gateway' ); ?></th>
                    <th><?php esc_html_e( 'Min Score', 'agenttrust-gateway' ); ?></th>
                    <th><?php esc_html_e( 'Parameters', 'agenttrust-gateway' ); ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ( $actions as $name => $action ) : ?>
                    <tr>
                        <td><code><?php echo esc_html( $name ); ?></code></td>
                        <td><?php echo esc_html( $action['description'] ); ?></td>
                        <td>
                            <span class="agenttrust-score-badge agenttrust-score-<?php echo $action['minScore'] >= 50 ? 'high' : 'low'; ?>">
                                <?php echo esc_html( $action['minScore'] ); ?>
                            </span>
                        </td>
                        <td>
                            <?php if ( ! empty( $action['parameters'] ) ) : ?>
                                <ul class="agenttrust-params-list">
                                    <?php foreach ( $action['parameters'] as $param_name => $param_def ) : ?>
                                        <li>
                                            <code><?php echo esc_html( $param_name ); ?></code>
                                            <span class="agenttrust-param-type">(<?php echo esc_html( $param_def['type'] ); ?>)</span>
                                            <?php if ( ! empty( $param_def['required'] ) ) : ?>
                                                <span class="agenttrust-param-required">*</span>
                                            <?php endif; ?>
                                        </li>
                                    <?php endforeach; ?>
                                </ul>
                            <?php else : ?>
                                <em><?php esc_html_e( 'None', 'agenttrust-gateway' ); ?></em>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    </div>

    <div class="agenttrust-help-section">
        <h2><?php esc_html_e( 'Help & Documentation', 'agenttrust-gateway' ); ?></h2>
        <ul>
            <li>
                <a href="https://docs.agenttrust.org/gateways/wordpress" target="_blank" rel="noopener noreferrer">
                    <?php esc_html_e( 'WordPress Gateway Documentation', 'agenttrust-gateway' ); ?>
                </a>
            </li>
            <li>
                <a href="https://docs.agenttrust.org/protocol" target="_blank" rel="noopener noreferrer">
                    <?php esc_html_e( 'AgentTrust Protocol Reference', 'agenttrust-gateway' ); ?>
                </a>
            </li>
            <li>
                <a href="https://docs.agenttrust.org/guides/custom-actions" target="_blank" rel="noopener noreferrer">
                    <?php esc_html_e( 'Adding Custom Actions', 'agenttrust-gateway' ); ?>
                </a>
            </li>
            <li>
                <a href="https://github.com/agenttrust/agenttrust" target="_blank" rel="noopener noreferrer">
                    <?php esc_html_e( 'GitHub Repository', 'agenttrust-gateway' ); ?>
                </a>
            </li>
        </ul>
    </div>
</div>
