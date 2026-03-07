import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  cancelMigrateLegacyData,
  getMigrationProgress,
  migrateLegacyData,
  startMigrateLegacyData,
} from "@/modules/settings/services/settingsService";
import { SETTINGS_MESSAGES } from "@/modules/settings/constants";
import type {
  MigrationCompletePayload,
  MigrationProgress,
} from "@/modules/settings/services/settingsService";
import type { AppSettingsResponse } from "@/modules/settings/types/settings.types";

export function useMigrationSettings({
  isTauri,
  settings,
  load,
  formatErrorMessage,
  setStorageMessage,
}: {
  isTauri: boolean;
  settings: AppSettingsResponse | null;
  load: () => Promise<void>;
  formatErrorMessage: (error: unknown) => string;
  setStorageMessage: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const [isMigrating, setIsMigrating] = useState(false);
  const [removeSource, setRemoveSource] = useState(true);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [migrationComplete, setMigrationComplete] = useState<MigrationCompletePayload | null>(null);
  const [migrationRemoveSource, setMigrationRemoveSource] = useState<boolean | null>(null);
  const migrationProgressRef = useRef<MigrationProgress | null>(null);

  useEffect(() => {
    if (!isTauri) return;

    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    void (async () => {
      try {
        unlistenProgress = await listen<MigrationProgress>("settings:migration-progress", (event) => {
          migrationProgressRef.current = event.payload;
          setMigrationProgress(event.payload);
        });
        unlistenComplete = await listen<MigrationCompletePayload>("settings:migration-complete", (event) => {
          setMigrationComplete(event.payload);
          if (event.payload.success) {
            const latest = migrationProgressRef.current;
            if ((latest?.total ?? 0) === 0 && (latest?.done ?? 0) === 0) {
              setStorageMessage(latest?.message ?? SETTINGS_MESSAGES.migration.noneFound);
            } else {
              setStorageMessage((migrationRemoveSource ?? removeSource) ? SETTINGS_MESSAGES.migration.successRemoved : SETTINGS_MESSAGES.migration.successKept);
            }
            void load();
          } else if (event.payload.canceled) {
            setStorageMessage(SETTINGS_MESSAGES.migration.canceled);
          } else {
            setStorageMessage(`${SETTINGS_MESSAGES.migration.failed}：${event.payload.error ?? SETTINGS_MESSAGES.unknownError}`);
          }
        });

        const p = await getMigrationProgress();
        migrationProgressRef.current = p;
        setMigrationProgress(p);
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
    };
  }, [isTauri, load, migrationRemoveSource, removeSource, setStorageMessage]);

  const legacyRoots = settings?.legacy_roots ?? [];
  const hasLegacy = legacyRoots.length > 0;
  const migrationRunning = migrationProgress?.running ?? false;

  const handleStartMigration = useCallback(async () => {
    const hasLegacyData = (settings?.legacy_roots?.length ?? 0) > 0;
    const running = migrationProgress?.running ?? false;
    if (!hasLegacyData || running) return;
    if (!isTauri) {
      setStorageMessage(SETTINGS_MESSAGES.desktopOnly);
      return;
    }

    try {
      setMigrationComplete(null);
      setMigrationRemoveSource(removeSource);
      await startMigrateLegacyData(removeSource);
      setStorageMessage(SETTINGS_MESSAGES.migration.startOk);
    } catch (e) {
      console.error(e);
      setStorageMessage(`${SETTINGS_MESSAGES.migration.startFailed}：${formatErrorMessage(e)}`);
    }
  }, [formatErrorMessage, isTauri, migrationProgress?.running, removeSource, setStorageMessage, settings?.legacy_roots?.length]);

  const handleCancelMigration = useCallback(async () => {
    if (!migrationProgress?.running) return;
    try {
      await cancelMigrateLegacyData();
    } catch (e) {
      console.error(e);
      setStorageMessage(`${SETTINGS_MESSAGES.migration.cancelFailed}：${formatErrorMessage(e)}`);
    }
  }, [formatErrorMessage, migrationProgress?.running, setStorageMessage]);

  const handleMigrateNow = useCallback(async () => {
    const hasLegacyData = (settings?.legacy_roots?.length ?? 0) > 0;
    const running = migrationProgress?.running ?? false;
    if (!hasLegacyData || isMigrating || running) return;
    if (!isTauri) {
      setStorageMessage(SETTINGS_MESSAGES.desktopOnly);
      return;
    }

    try {
      setIsMigrating(true);
      await migrateLegacyData(removeSource);
      await load();
      setStorageMessage(removeSource ? SETTINGS_MESSAGES.migration.runDoneRemoved : SETTINGS_MESSAGES.migration.runDoneKept);
    } catch (e) {
      console.error(e);
      setStorageMessage(`${SETTINGS_MESSAGES.migration.runFailed}：${formatErrorMessage(e)}`);
    } finally {
      setIsMigrating(false);
    }
  }, [formatErrorMessage, isMigrating, isTauri, load, migrationProgress?.running, removeSource, setStorageMessage, settings?.legacy_roots?.length]);

  return {
    isMigrating,
    removeSource,
    setRemoveSource,
    migrationProgress,
    migrationComplete,
    migrationRemoveSource,
    legacyRoots,
    hasLegacy,
    migrationRunning,
    handleStartMigration,
    handleCancelMigration,
    handleMigrateNow,
  };
}
