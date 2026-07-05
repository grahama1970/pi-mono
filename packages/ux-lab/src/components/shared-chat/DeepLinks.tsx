/**
 * DeepLinks — Configurable deep-link system for entity navigation.
 *
 * When a user clicks a highlighted entity (AC-17, CWE-79, T1059, /assess),
 * this module determines where to navigate based on entity type and
 * user-configured external tool integrations.
 *
 * Built-in targets (UX Lab projects):
 *   - Controls/ATT&CK/SPARTA → SPARTA Explorer threat matrix
 *   - CWEs → Binary Explorer
 *   - Skills → populate input
 *   - Frameworks → /memory recall
 *
 * Configurable external targets:
 *   - IDA Pro: ida://open?address={entity}
 *   - Splunk: https://splunk.corp/search?q={entity}
 *   - Grafana: https://grafana.internal/d/dashboard?var={entity}
 *   - Jira: https://jira.corp/search?query={entity}
 */
import type { EntityType } from './types';

export interface DeepLinkConfig {
  /** IDA Pro protocol handler URL template. Use {entity} as placeholder. */
  ida?: string;
  /** Splunk search URL template */
  splunk?: string;
  /** Grafana dashboard URL template */
  grafana?: string;
  /** Jira/ticket system URL template */
  jira?: string;
  /** Custom external links: name → URL template */
  custom?: Record<string, string>;
}

// Default: no external tools configured, use UX Lab internal navigation
const DEFAULT_CONFIG: DeepLinkConfig = {};

let _config: DeepLinkConfig = DEFAULT_CONFIG;

export function configureDeepLinks(config: DeepLinkConfig) {
  _config = { ...DEFAULT_CONFIG, ...config };
}

export function getDeepLinkConfig(): DeepLinkConfig {
  return _config;
}

/**
 * Resolve where to navigate when an entity is clicked.
 * Returns an array of actions — the first is the primary (auto-executed),
 * additional ones are offered as "Also open in..." options.
 */
export interface DeepLinkAction {
  label: string;
  type: 'navigate-hash' | 'open-url' | 'set-input' | 'send-message';
  value: string;
  icon?: string; // emoji or short label
}

export function resolveEntityActions(entity: string, entityType: EntityType): DeepLinkAction[] {
  const actions: DeepLinkAction[] = [];

  switch (entityType) {
    case 'skill':
      actions.push({ label: `Invoke ${entity}`, type: 'set-input', value: `${entity} `, icon: '/' });
      break;

    case 'control':
    case 'attack':
    case 'sparta':
      // Primary: navigate to SPARTA Explorer threat matrix
      actions.push({
        label: `View ${entity} in Threat Matrix`,
        type: 'navigate-hash',
        value: `sparta-explorer/threat-matrix?focus=${encodeURIComponent(entity)}`,
        icon: 'M',
      });
      // Secondary: memory recall for context
      actions.push({
        label: `Recall ${entity} from memory`,
        type: 'send-message',
        value: `/memory recall "${entity}"`,
        icon: 'R',
      });
      // External: Splunk correlation if configured
      if (_config.splunk) {
        actions.push({
          label: `Correlate in Splunk`,
          type: 'open-url',
          value: _config.splunk.replace('{entity}', encodeURIComponent(entity)),
          icon: 'S',
        });
      }
      break;

    case 'cwe':
      // Primary: navigate to Binary Explorer
      actions.push({
        label: `Analyze ${entity} in Binary Explorer`,
        type: 'navigate-hash',
        value: `binary-explorer?cwe=${encodeURIComponent(entity)}`,
        icon: 'B',
      });
      // External: IDA Pro deep link if configured
      if (_config.ida) {
        actions.push({
          label: `Open in IDA Pro`,
          type: 'open-url',
          value: _config.ida.replace('{entity}', encodeURIComponent(entity)),
          icon: 'I',
        });
      }
      // External: Splunk for exploit telemetry
      if (_config.splunk) {
        actions.push({
          label: `Search ${entity} in Splunk`,
          type: 'open-url',
          value: _config.splunk.replace('{entity}', encodeURIComponent(entity)),
          icon: 'S',
        });
      }
      break;

    case 'framework':
      // Framework refs (NIST 800-171, CMMC Level 2) → memory recall
      actions.push({
        label: `Recall ${entity}`,
        type: 'send-message',
        value: `/memory recall "${entity}"`,
        icon: 'R',
      });
      // External: Jira for compliance tickets
      if (_config.jira) {
        actions.push({
          label: `Search tickets for ${entity}`,
          type: 'open-url',
          value: _config.jira.replace('{entity}', encodeURIComponent(entity)),
          icon: 'J',
        });
      }
      break;
  }

  // Add any custom links
  if (_config.custom) {
    for (const [name, template] of Object.entries(_config.custom)) {
      actions.push({
        label: `Open in ${name}`,
        type: 'open-url',
        value: template.replace('{entity}', encodeURIComponent(entity)),
        icon: name[0].toUpperCase(),
      });
    }
  }

  return actions;
}

/**
 * Execute the primary action for an entity click.
 * Returns the action that was executed, or null if none.
 */
export function executePrimaryAction(
  entity: string,
  entityType: EntityType,
  setInput: (v: string) => void,
  sendMessage: () => void,
  focusInput: () => void,
): DeepLinkAction | null {
  const actions = resolveEntityActions(entity, entityType);
  if (actions.length === 0) return null;

  const action = actions[0];
  switch (action.type) {
    case 'navigate-hash':
      window.location.hash = action.value;
      break;
    case 'open-url':
      window.open(action.value, '_blank');
      break;
    case 'set-input':
      setInput(action.value);
      focusInput();
      break;
    case 'send-message':
      setInput(action.value);
      setTimeout(sendMessage, 100);
      break;
  }
  return action;
}
