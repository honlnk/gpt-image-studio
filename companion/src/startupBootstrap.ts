import { resolveDeploymentConfig, type DeploymentMode } from "./deploymentConfig.js";

export function bootstrapDataDir(args: string[]): string {
  if (process.env.GPT_IMAGE_STUDIO_CONFIG_DIR) {
    return process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  }

  const deployment = resolveDeploymentConfig({
    mode: readDeploymentMode(args),
  });
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = deployment.dataDir;
  return deployment.dataDir;
}

export function readDeploymentMode(args: string[]): DeploymentMode | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--deployment-mode") {
      return parseDeploymentMode(args[index + 1]);
    }
    if (arg.startsWith("--deployment-mode=")) {
      return parseDeploymentMode(arg.slice("--deployment-mode=".length));
    }
  }
  return undefined;
}

function parseDeploymentMode(value: string | undefined): DeploymentMode | undefined {
  if (value === undefined) return undefined;
  if (value === "local" || value === "server") return value;
  return value as DeploymentMode;
}
