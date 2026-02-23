=== AgentTrust Gateway ===
Contributors: agenttrust
Tags: ai, agents, trust, security, api
Requires at least: 5.8
Tested up to: 6.4
Requires PHP: 7.4
Stable tag: 1.0.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Add AI agent trust verification to your WordPress site with reputation-based access control.

== Description ==

AgentTrust Gateway brings the AgentTrust protocol to WordPress, allowing verified AI agents to interact with your site through a secure, reputation-scored gateway.

Instead of exposing raw APIs or relying on API keys alone, AgentTrust verifies agent identity through cryptographic certificates issued by the AgentTrust Station. Each agent carries a trust score that determines which actions they can perform on your site.

**Key Features:**

* Cryptographic verification of agent identity via JWT certificates
* Reputation-based access control with configurable minimum scores per action
* Built-in actions for posts, categories, comments, and WooCommerce
* Extensible action system via WordPress filters
* Automatic usage reporting to the AgentTrust Station
* Standard discovery endpoint for agent auto-configuration
* Full WooCommerce integration for product queries and order creation

**How It Works:**

1. An AI agent obtains a certificate from the AgentTrust Station
2. The agent discovers your gateway via the well-known discovery endpoint
3. The agent sends requests with its certificate in the Authorization header
4. The plugin verifies the certificate and checks the agent's trust score
5. If the score meets the action's minimum requirement, the action is executed
6. A usage report is submitted back to the Station

== Installation ==

1. Upload the `agenttrust-gateway` folder to `/wp-content/plugins/`
2. Activate the plugin through the 'Plugins' menu in WordPress
3. Go to Settings > AgentTrust to configure your Station URL and API key
4. Share your discovery URL with agent developers

**Manual Installation:**

1. Download the plugin zip file
2. Go to Plugins > Add New > Upload Plugin
3. Upload the zip file and click Install Now
4. Activate the plugin

== Frequently Asked Questions ==

= What is an AgentTrust Station? =

The AgentTrust Station is the central authority that issues and verifies agent certificates. It maintains agent reputation scores and processes usage reports from gateways like this plugin.

= Do I need to run my own Station? =

No. You can use the public AgentTrust Station at `https://agentgateway-6f041c655eb3.herokuapp.com`, or you can self-host your own instance for full control.

= What trust scores should I set for my actions? =

We recommend:
* Read-only actions (search, get): 20-30
* Write actions (comments): 40-50
* Transactional actions (orders): 60-80

Higher scores provide more security but restrict access to fewer agents.

= Does this work with WooCommerce? =

Yes. When WooCommerce is active, the plugin automatically adds `get_products` and `create_order` actions to the gateway.

= Can I add custom actions? =

Yes. Use the `agenttrust_gateway_actions` filter to add your own actions, and the `agenttrust_execute_custom_action` filter to handle their execution.

= Is this compatible with caching plugins? =

Yes. The REST API endpoints bypass page caching. The Station public key is cached in a WordPress transient for 1 hour.

== Changelog ==

= 1.0.0 =
* Initial release
* Core gateway with certificate verification
* Built-in actions: search_posts, get_post, get_categories, submit_comment
* WooCommerce integration: get_products, create_order
* Admin settings page with connection status
* REST API discovery endpoint
* Usage report submission

== Upgrade Notice ==

= 1.0.0 =
Initial release of the AgentTrust Gateway for WordPress.
