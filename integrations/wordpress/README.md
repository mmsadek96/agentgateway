# AgentTrust Gateway for WordPress

A WordPress plugin that adds AI agent trust verification to your site. Agents interact with your content through a verified gateway with reputation scoring powered by the AgentTrust protocol.

## Installation

### From WordPress Admin

1. Download the plugin zip file.
2. Go to **Plugins > Add New > Upload Plugin**.
3. Upload the zip file and click **Install Now**.
4. Activate the plugin.

### Manual Installation

1. Copy the `agenttrust-gateway` directory into `wp-content/plugins/`.
2. Activate the plugin from the **Plugins** screen in WordPress admin.

### From Source

```bash
cd wp-content/plugins/
git clone https://github.com/agenttrust/agenttrust.git
# The WordPress plugin is at integrations/wordpress/
ln -s agenttrust/integrations/wordpress agenttrust-gateway
```

## Configuration

1. Navigate to **Settings > AgentTrust** in the WordPress admin.
2. Enter your **Station URL** (default: `https://station.agenttrust.org`).
3. Enter your **API Key** obtained from the AgentTrust Station.
4. The **Gateway ID** is auto-generated on activation. You can change it if needed.
5. Set the **Default Minimum Score** for actions that do not specify their own.

## REST API Endpoints

All endpoints are under the `agenttrust/v1` namespace.

### Discovery (Public)

```
GET /wp-json/agenttrust/v1/discovery
GET /wp-json/agenttrust/v1/.well-known/agent-gateway
```

Returns the gateway configuration, available actions, minimum score requirements, and authentication instructions. No authorization required.

### Execute Action (Authenticated)

```
POST /wp-json/agenttrust/v1/actions/{action_name}
Authorization: Bearer <agent-certificate-jwt>
Content-Type: application/json
```

Executes the specified action. Requires a valid AgentTrust certificate in the Authorization header. The agent's trust score must meet or exceed the action's minimum score.

## Built-in Actions

| Action | Min Score | Description |
|--------|-----------|-------------|
| `search_posts` | 20 | Search published posts by keyword |
| `get_post` | 30 | Retrieve a single post by ID |
| `get_categories` | 20 | List post categories |
| `submit_comment` | 50 | Submit a comment (held for moderation) |
| `get_products` | 30 | Search WooCommerce products (requires WooCommerce) |
| `create_order` | 70 | Create a WooCommerce order (requires WooCommerce) |

## Adding Custom Actions

Use the `agenttrust_gateway_actions` filter to register new actions and `agenttrust_execute_custom_action` to handle execution.

```php
// Register a custom action.
add_filter( 'agenttrust_gateway_actions', function( $actions ) {
    $actions['get_site_stats'] = array(
        'description' => 'Get basic site statistics.',
        'minScore'    => 40,
        'parameters'  => array(
            'period' => array(
                'type'        => 'string',
                'required'    => false,
                'description' => 'Time period: day, week, month.',
                'default'     => 'month',
            ),
        ),
    );
    return $actions;
});

// Handle custom action execution.
add_filter( 'agenttrust_execute_custom_action', function( $result, $action_name, $params, $agent_context ) {
    if ( 'get_site_stats' !== $action_name ) {
        return $result;
    }

    $post_count    = wp_count_posts();
    $comment_count = wp_count_comments();

    return array(
        'posts'    => $post_count->publish,
        'comments' => $comment_count->approved,
        'period'   => isset( $params['period'] ) ? $params['period'] : 'month',
    );
}, 10, 4 );
```

## Available Hooks and Filters

### Filters

| Filter | Description |
|--------|-------------|
| `agenttrust_gateway_actions` | Modify the list of available actions |
| `agenttrust_execute_custom_action` | Handle execution of custom actions |
| `agenttrust_comment_data` | Modify comment data before insertion |
| `agenttrust_discovery_response` | Modify the discovery endpoint response |

### Actions

| Hook | Description |
|------|-------------|
| `agenttrust_before_action` | Fires before any action is executed |
| `agenttrust_after_action` | Fires after any action is executed |

## Requirements

- WordPress 5.8 or higher
- PHP 7.4 or higher
- OpenSSL PHP extension (for JWT verification)
- WooCommerce 5.0+ (optional, for product/order actions)

## Development

### File Structure

```
integrations/wordpress/
  agenttrust-gateway.php          # Main plugin entry point
  readme.txt                      # WordPress.org plugin readme
  README.md                       # Developer documentation
  includes/
    class-station-client.php      # Station API communication
    class-gateway.php             # Core gateway logic and actions
    class-admin-settings.php      # Admin settings registration
    class-rest-api.php            # REST API route registration
  admin/
    settings-page.php             # Admin settings page template
    admin.css                     # Admin page styles
```

### Testing Agent Requests

You can test the gateway using curl:

```bash
# Discover available actions
curl https://your-site.com/wp-json/agenttrust/v1/discovery

# Execute an action (requires a valid agent certificate)
curl -X POST https://your-site.com/wp-json/agenttrust/v1/actions/search_posts \
  -H "Authorization: Bearer <your-agent-certificate-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"query": "hello world"}'
```

## Links

- [AgentTrust Documentation](https://docs.agenttrust.org)
- [WordPress Gateway Guide](https://docs.agenttrust.org/gateways/wordpress)
- [AgentTrust Protocol Specification](https://docs.agenttrust.org/protocol)
- [GitHub Repository](https://github.com/agenttrust/agenttrust)

## License

MIT License. See the [LICENSE](../../LICENSE) file for details.
