import { readSettings, writeSettings } from "@/lib/settings"
import {
  deleteWorkflowFile,
  listWorkflowFiles,
  readWorkflowFile,
  writeWorkflowFile,
} from "@/lib/workflows"
import {
  detectMapping,
  extractValues,
  listMappableInputs,
  mergeMapping,
  parseApiWorkflow,
} from "@/lib/workflow-core"
import type { MappingOverrides } from "@/lib/types"

export { listWorkflowFiles }

export async function parseAndSaveWorkflow(name: string, data: unknown) {
  const parsed = parseApiWorkflow(data)
  return writeWorkflowFile(name, parsed)
}

export async function readWorkflowBundle(name: string) {
  const { filename, data } = await readWorkflowFile(name)
  const workflow = parseApiWorkflow(data)
  const detected = detectMapping(workflow)
  const settings = await readSettings()
  const overrides = settings.mappings[filename]
  const mapping = mergeMapping(detected, overrides)
  return {
    name: filename,
    mapping,
    detected,
    overrides: overrides ?? {},
    values: extractValues(workflow, mapping),
    nodes: listMappableInputs(workflow),
  }
}

export async function saveMappingOverrides(
  name: string,
  overrides: MappingOverrides
) {
  const { filename } = await readWorkflowFile(name)
  const settings = await readSettings()
  settings.mappings[filename] = overrides
  await writeSettings(settings)
  return readWorkflowBundle(filename)
}

export async function removeWorkflow(name: string) {
  const filename = await deleteWorkflowFile(name)
  const settings = await readSettings()
  if (settings.mappings[filename]) {
    delete settings.mappings[filename]
  }
  if (settings.defaultWorkflow === filename) {
    settings.defaultWorkflow = null
  }
  await writeSettings(settings)
  return filename
}

export { readWorkflowFile }
