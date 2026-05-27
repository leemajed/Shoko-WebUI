import { useMutation } from '@tanstack/react-query';
import jsonpatch from 'fast-json-patch';

import { axios } from '@/core/axios';
import queryClient, { invalidateQueries } from '@/core/react-query/queryClient';
import { transformSettings } from '@/core/react-query/settings/helpers';

import type { AniDBLoginRequestType } from '@/core/react-query/settings/types';
import type { SettingsServerType, SettingsType } from '@/core/types/api/settings';
import type { Operation } from 'fast-json-patch';

const transformSettingsIfNeeded = (
  settings: SettingsServerType | SettingsType,
) => (typeof settings.WebUI_Settings === 'string'
  ? transformSettings(settings as SettingsServerType)
  : settings);

const isJsonObjectString = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') return false;

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
};

const isValueOperation = (operation: Operation): operation is Extract<Operation, { value: unknown }> =>
  'value' in operation;

const isValidSettingsPatchOperation = (operation: Operation) => {
  if (operation.path !== '/WebUI_Settings') return true;
  if (operation.op === 'remove') return false;
  if (operation.op !== 'add' && operation.op !== 'replace') return true;
  if (!isValueOperation(operation)) return false;
  return isJsonObjectString(operation.value);
};

const summarizePatchOperation = (operation: Operation) => {
  const hasValue = isValueOperation(operation);
  const value = hasValue ? operation.value as unknown : undefined;
  return {
    op: operation.op,
    path: operation.path,
    valueIsEmpty: !hasValue || (typeof value === 'string' && value.trim() === ''),
    valueType: typeof value,
  };
};

export const useAniDBTestLoginMutation = () =>
  useMutation({
    mutationFn: (body: AniDBLoginRequestType) => axios.post('Settings/AniDB/TestLogin', body),
  });

export const useCheckNetworkConnectivityMutation = () =>
  useMutation({
    mutationFn: () => axios.post('Init/Connectivity'),
  });

export const usePatchSettingsMutation = () =>
  useMutation({
    mutationFn: async (newSettings: SettingsServerType | SettingsType) => {
      const cachedSettings = queryClient.getQueryData<SettingsServerType | SettingsType>(['settings']);
      if (!cachedSettings) return;

      const oldSettings = transformSettingsIfNeeded(cachedSettings);
      const changedSettings = transformSettingsIfNeeded(newSettings);
      const original: SettingsServerType = {
        ...oldSettings,
        WebUI_Settings: JSON.stringify(oldSettings.WebUI_Settings),
      };
      const changed: SettingsServerType = {
        ...changedSettings,
        WebUI_Settings: JSON.stringify(changedSettings.WebUI_Settings),
      };
      const operations = jsonpatch.compare(original, changed);
      console.warn('PATCH Settings payload summary', JSON.stringify(operations.map(summarizePatchOperation)));

      const data = operations.filter(isValidSettingsPatchOperation);
      if (data.length !== operations.length) {
        console.warn(
          'PATCH Settings skipped invalid operations',
          JSON.stringify(
            operations
              .filter(operation => !isValidSettingsPatchOperation(operation))
              .map(summarizePatchOperation),
          ),
        );
      }
      if (data.length === 0) return;

      await axios.patch('Settings', data);
    },
    onSuccess: () => invalidateQueries(['settings']),
  });
