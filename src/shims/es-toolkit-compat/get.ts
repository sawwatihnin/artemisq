import {getValueByPath} from './shared';

export default function get<T>(target: T, path: string | string[], defaultValue?: unknown) {
  return getValueByPath(target, path, defaultValue);
}
