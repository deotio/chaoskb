export interface AgentConfig {
  name: string;
  displayName: string;
  /** Platforms this agent is available on */
  platforms: ('darwin' | 'linux' | 'win32')[];
  /** Paths to check for agent installation */
  installPaths: Record<string, string[]>;
  /** Path to MCP config file */
  configPath: Record<string, string>;
  /** MCP config format */
  configFormat: 'json';
  /** Whether agent supports project-level config */
  supportsProjectConfig: boolean;
  /** Project config file path pattern */
  projectConfigPath?: string;
}

export interface DetectedAgent {
  config: AgentConfig;
  installed: boolean;
  configExists: boolean;
  configFilePath: string;
  registered: boolean;
}

export interface AgentRegistry {
  version: number;
  updatedAt: string;
  agents: AgentConfig[];
}
