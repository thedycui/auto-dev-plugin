/**
 * ProcessLockManager — Manages process locking to prevent concurrent instances.
 *
 * Provides:
 * - Lock acquisition with PID tracking
 * - Lock release
 * - Lock validation and cleanup of stale locks
 * - Existing lock information retrieval
 */

import { writeFile, unlink, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pid } from 'node:process';

interface LockInfo {
  pid: number;
  topic: string;
  projectRoot: string;
  startTime: number;
  hostname: string;
}

interface LockResult {
  acquired: boolean;
  lockFile?: string;
  existingLock?: LockInfo;
}

export class ProcessLockManager {
  private readonly LOCK_DIR = '.auto-dev';
  private readonly LOCK_PREFIX = 'lock-';
  private readonly LOCK_EXTENSION = '.json';

  /**
   * Acquire a process lock for the given project and topic
   */
  async acquireLock(projectRoot: string, topic: string): Promise<LockResult> {
    const lockFile = this.getLockFilePath(projectRoot, topic);

    try {
      // Check if lock file already exists
      if (existsSync(lockFile)) {
        const existingLock = await this.readLockFile(lockFile);

        if (existingLock) {
          // Check if the process is still running
          const isRunning = await this.isProcessRunning(existingLock.pid);

          if (isRunning) {
            // Process is still running, can't acquire lock
            return {
              acquired: false,
              lockFile,
              existingLock,
            };
          } else {
            // Process is dead, remove stale lock
            try {
              await unlink(lockFile);
              console.log(`Removed stale lock file: ${lockFile}`);
            } catch (error) {
              console.warn(
                `Failed to remove stale lock file ${lockFile}:`,
                error
              );
              return {
                acquired: false,
                lockFile,
                existingLock,
              };
            }
          }
        }
      }

      // Create new lock file
      const lockInfo: LockInfo = {
        pid: pid,
        topic,
        projectRoot,
        startTime: Date.now(),
        hostname: this.getHostname(),
      };

      await this.writeLockFile(lockFile, lockInfo);

      return {
        acquired: true,
        lockFile,
      };
    } catch (error) {
      console.error(`Failed to acquire lock for ${topic}:`, error);
      return {
        acquired: false,
        lockFile,
      };
    }
  }

  /**
   * Release a process lock
   */
  async releaseLock(lockFile: string): Promise<boolean> {
    try {
      if (existsSync(lockFile)) {
        await unlink(lockFile);
        console.log(`Released lock: ${lockFile}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to release lock ${lockFile}:`, error);
      return false;
    }
  }

  /**
   * Read lock file and parse lock info
   */
  private async readLockFile(lockFile: string): Promise<LockInfo | null> {
    try {
      const content = await readFile(lockFile, 'utf-8');
      const lockInfo = JSON.parse(content) as LockInfo;

      // Validate lock info structure
      if (
        typeof lockInfo.pid === 'number' &&
        typeof lockInfo.topic === 'string' &&
        typeof lockInfo.projectRoot === 'string' &&
        typeof lockInfo.startTime === 'number'
      ) {
        return lockInfo;
      }

      return null;
    } catch (error) {
      console.warn(`Failed to read lock file ${lockFile}:`, error);
      return null;
    }
  }

  /**
   * Write lock info to lock file
   */
  private async writeLockFile(
    lockFile: string,
    lockInfo: LockInfo
  ): Promise<void> {
    const content = JSON.stringify(lockInfo, null, 2);
    await writeFile(lockFile, content, 'utf-8');
  }

  /**
   * Check if a process with the given PID is running
   */
  private async isProcessRunning(pid: number): Promise<boolean> {
    try {
      // On Unix-like systems, we can check if the process exists by sending signal 0
      // This doesn't actually kill the process, just checks if it exists
      const { kill } = await import('node:process');

      // Try to send signal 0 to check if process exists
      // This will throw an error if the process doesn't exist
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // Process doesn't exist or we don't have permission
      return false;
    }
  }

  /**
   * Get the lock file path for a given project and topic
   */
  private getLockFilePath(projectRoot: string, topic: string): string {
    // Sanitize topic for filename
    const sanitizedTopic = topic.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(
      projectRoot,
      this.LOCK_DIR,
      `${this.LOCK_PREFIX}${sanitizedTopic}${this.LOCK_EXTENSION}`
    );
  }

  /**
   * Get the current hostname
   */
  private getHostname(): string {
    try {
      const { hostname } = require('node:os');
      return hostname();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Validate an existing lock file and return its info
   */
  async getLockInfo(
    projectRoot: string,
    topic: string
  ): Promise<LockInfo | null> {
    const lockFile = this.getLockFilePath(projectRoot, topic);

    if (!existsSync(lockFile)) {
      return null;
    }

    return await this.readLockFile(lockFile);
  }

  /**
   * Clean up all stale locks for a project
   */
  async cleanupStaleLocks(projectRoot: string): Promise<number> {
    const lockDir = join(projectRoot, this.LOCK_DIR);
    let cleanedCount = 0;

    try {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(lockDir, { withFileTypes: true });

      for (const entry of entries) {
        if (
          entry.isFile() &&
          entry.name.startsWith(this.LOCK_PREFIX) &&
          entry.name.endsWith(this.LOCK_EXTENSION)
        ) {
          const lockFile = join(lockDir, entry.name);
          const lockInfo = await this.readLockFile(lockFile);

          if (lockInfo) {
            const isRunning = await this.isProcessRunning(lockInfo.pid);
            if (!isRunning) {
              try {
                await unlink(lockFile);
                cleanedCount++;
                console.log(`Cleaned up stale lock: ${lockFile}`);
              } catch (error) {
                console.warn(`Failed to remove stale lock ${lockFile}:`, error);
              }
            }
          }
        }
      }
    } catch (error) {
      // Lock directory may not exist yet
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Failed to scan for stale locks in ${lockDir}:`, error);
      }
    }

    return cleanedCount;
  }
}

// Export singleton instance
export const processLockManager = new ProcessLockManager();
