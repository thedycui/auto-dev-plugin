/**
 * CleanupManager — Manages temporary file cleanup and signal handlers.
 *
 * Provides:
 * - Signal handler registration for graceful shutdown
 * - Temporary file/directory registration and cleanup
 * - Orphaned temp file cleanup
 * - Old backup cleanup
 */

import { readdir, unlink, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface CleanupEntry {
  path: string;
  description: string;
  registeredAt: Date;
}

export class CleanupManager {
  private readonly registeredEntries: Map<string, CleanupEntry> = new Map();
  private signalHandlersRegistered = false;

  /**
   * Register a signal handler for graceful shutdown
   */
  registerSignalHandlers(): void {
    if (this.signalHandlersRegistered) {
      return;
    }

    const signals = ['SIGINT', 'SIGTERM', 'exit'];

    for (const signal of signals) {
      try {
        process.on(signal as NodeJS.Signals, () => this.cleanupAllSync());
      } catch (e) {
        // Some signals may not be available in all environments
        console.warn(`Failed to register signal handler for ${signal}:`, e);
      }
    }

    this.signalHandlersRegistered = true;
  }

  /**
   * Register a temporary file or directory for cleanup
   */
  register(path: string, description: string): void {
    this.registeredEntries.set(path, {
      path,
      description,
      registeredAt: new Date(),
    });
  }

  /**
   * Clean up a specific registered entry
   */
  async cleanupEntry(path: string): Promise<boolean> {
    const entry = this.registeredEntries.get(path);
    if (!entry) {
      return false;
    }

    try {
      await this.removePath(entry.path);
      this.registeredEntries.delete(path);
      return true;
    } catch (error) {
      console.warn(
        `Failed to cleanup ${entry.description} at ${entry.path}:`,
        error
      );
      return false;
    }
  }

  /**
   * Clean up all registered entries
   */
  async cleanupAll(): Promise<void> {
    const cleanupPromises = Array.from(this.registeredEntries.entries()).map(
      async ([path, entry]) => {
        try {
          await this.removePath(entry.path);
          this.registeredEntries.delete(path);
        } catch (error) {
          console.warn(
            `Failed to cleanup ${entry.description} at ${entry.path}:`,
            error
          );
        }
      }
    );

    await Promise.allSettled(cleanupPromises);
  }

  /**
   * Clean up all registered entries synchronously (for signal handlers)
   */
  private cleanupAllSync(): void {
    for (const [path, entry] of this.registeredEntries.entries()) {
      try {
        // Use sync operations for signal handlers
        const { existsSync, unlinkSync, rmSync } = require('node:fs');

        if (existsSync(entry.path)) {
          const stats = require('node:fs').statSync(entry.path);
          if (stats.isDirectory()) {
            rmSync(entry.path, { recursive: true, force: true });
          } else {
            unlinkSync(entry.path);
          }
        }
        this.registeredEntries.delete(path);
      } catch (error) {
        console.warn(
          `Failed to cleanup ${entry.description} at ${entry.path}:`,
          error
        );
      }
    }
  }

  /**
   * Clean up orphaned temporary files in the project root
   */
  async cleanupOrphanedTempFiles(projectRoot: string): Promise<void> {
    const tmpPattern = join(projectRoot, '.auto-dev-tmp-*');

    try {
      const entries = await readdir(projectRoot, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.auto-dev-tmp-') && entry.isDirectory()) {
          const tempPath = join(projectRoot, entry.name);
          try {
            await rm(tempPath, { recursive: true, force: true });
            console.log(`Cleaned up orphaned temp directory: ${tempPath}`);
          } catch (error) {
            console.warn(
              `Failed to remove orphaned temp directory ${tempPath}:`,
              error
            );
          }
        }
      }
    } catch (error) {
      console.warn(
        `Failed to scan for orphaned temp files in ${projectRoot}:`,
        error
      );
    }
  }

  /**
   * Clean up old backups (older than specified days)
   */
  async cleanupOldBackups(
    projectRoot: string,
    daysToKeep: number = 30
  ): Promise<void> {
    const backupDir = join(projectRoot, '.auto-dev', 'backups');
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    try {
      const entries = await readdir(backupDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() || entry.isDirectory()) {
          const backupPath = join(backupDir, entry.name);
          try {
            const stats = await stat(backupPath);

            if (stats.mtime.getTime() < cutoffTime) {
              await rm(backupPath, { recursive: true, force: true });
              console.log(`Cleaned up old backup: ${backupPath}`);
            }
          } catch (error) {
            console.warn(`Failed to remove old backup ${backupPath}:`, error);
          }
        }
      }
    } catch (error) {
      // Backup directory may not exist yet
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Failed to scan for old backups in ${backupDir}:`, error);
      }
    }
  }

  /**
   * Helper to remove a file or directory
   */
  private async removePath(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }

  /**
   * Get count of registered entries
   */
  getRegisteredCount(): number {
    return this.registeredEntries.size;
  }
}

// Export singleton instance
export const cleanupManager = new CleanupManager();
