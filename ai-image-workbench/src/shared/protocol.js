export const PLATFORM_VERSION = '1.0.0';
export const CAPABILITIES = new Set(['image.read', 'image.validate', 'image.generate', 'image.download', 'history.write', 'prompt.resolve', 'task.progress']);
export const TASK_STATES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled', 'cancelled_by_rollback']);

export class PlatformError extends Error {
  constructor(code, message, options = {}) { super(message); this.name = 'PlatformError'; this.code = code; this.retryable = Boolean(options.retryable); Object.assign(this, options); }
  toJSON() { return { code: this.code, message: this.message, retryable: this.retryable, stepId: this.stepId, moduleId: this.moduleId, moduleVersion: this.moduleVersion, taskId: this.taskId }; }
}
