import path from "node:path"

export function rootDir() {
  return process.cwd()
}

export function workflowsDir() {
  return path.join(rootDir(), "workflows")
}

export function outputsDir() {
  return path.join(rootDir(), "outputs")
}

export function dataDir() {
  return path.join(rootDir(), "data")
}

export function settingsPath() {
  return path.join(dataDir(), "settings.json")
}

export function jobsPath() {
  return path.join(dataDir(), "jobs.json")
}

export function jobOutputDir(jobId: string) {
  return path.join(outputsDir(), jobId)
}
