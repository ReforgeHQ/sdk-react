import React, { PropsWithChildren } from "react";
import {
  reforge,
  type CollectContextModeType,
  type ConfigValue,
  Context,
  type Duration,
  Reforge,
} from "@reforge-com/javascript";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require("../package.json");

// @reforge-com/cli#generate will create interfaces into this namespace for React to consume
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ReactHookConfigurationRaw {}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ReactHookConfigurationAccessor {}

export type TypedReactHookConfigurationRaw = keyof ReactHookConfigurationRaw extends never
  ? Record<string, unknown>
  : {
      [TypedFlagKey in keyof ReactHookConfigurationRaw]: ReactHookConfigurationRaw[TypedFlagKey];
    };

export type TypedReactHookConfigurationAccessor = keyof ReactHookConfigurationAccessor extends never
  ? Record<string, unknown>
  : {
      [TypedFlagKey in keyof ReactHookConfigurationAccessor]: ReactHookConfigurationAccessor[TypedFlagKey];
    };

type ContextValue = number | string | boolean;
type ContextAttributes = Record<string, Record<string, ContextValue>>;
type EvaluationCallback = (key: string, value: ConfigValue, context: Context | undefined) => void;

type ClassMethods<T> = { [K in keyof T]: T[K] };

interface ReforgeTypesafeInterface {
  get<K extends keyof TypedReactHookConfigurationRaw>(key: K): TypedReactHookConfigurationRaw[K];
  get reforge(): Reforge;
}

type ReforgeTypesafeClass<T extends ReforgeTypesafeInterface = ReforgeTypesafeInterface> = new (
  reforgeInstance: Reforge
) => T;

type SharedSettings = {
  sdkKey?: string;
  endpoints?: string[];
  apiEndpoint?: string;
  timeout?: number;
  pollInterval?: number;
  onError?: (error: Error) => void;
  afterEvaluationCallback?: EvaluationCallback;
  collectEvaluationSummaries?: boolean;
  collectLoggerNames?: boolean;
  collectContextMode?: CollectContextModeType;
};

export type BaseContext = {
  get: <K extends keyof TypedReactHookConfigurationRaw>(
    key: K
  ) => TypedReactHookConfigurationRaw[K];
  getDuration: <K extends keyof TypedReactHookConfigurationRaw>(key: K) => Duration | undefined;
  contextAttributes: ContextAttributes;
  isEnabled: <K extends keyof TypedReactHookConfigurationRaw>(key: K) => boolean;
  loading: boolean;
  reforge: typeof reforge;
  keys: (keyof TypedReactHookConfigurationRaw)[];
  settings: SharedSettings;
};

export type ProvidedContext = BaseContext & ClassMethods<ReforgeTypesafeClass>;

export const defaultContext: BaseContext = {
  get: (_key) => undefined,
  getDuration: (_key) => undefined,
  isEnabled: (_key) => false,
  keys: [],
  loading: true,
  contextAttributes: {},
  reforge,
  settings: {},
};

export const ReforgeContext = React.createContext<ProvidedContext>(
  defaultContext as ProvidedContext
);

// This is a factory function that creates a fully typed useReforge hook for a specific ReforgeTypesafe class
export function createReforgeHook<T extends ReforgeTypesafeInterface>(
  TypesafeClass: ReforgeTypesafeClass<T>
) {
  return function useReforgeHook(): BaseContext & T {
    const baseContext = React.useContext(ReforgeContext);

    // Memoize the typesafe instance to prevent unnecessary constructor calls
    const typesafeInstance = React.useMemo(() => {
      const instance = new TypesafeClass(baseContext.reforge);

      // Copy baseContext properties to typesafeInstance except for `get` + `reforge`
      Object.assign(instance as any, {
        getDuration: baseContext.getDuration,
        contextAttributes: baseContext.contextAttributes,
        isEnabled: baseContext.isEnabled,
        loading: baseContext.loading,
        keys: baseContext.keys,
        settings: baseContext.settings,
      });

      return instance;
    }, [baseContext]);

    return typesafeInstance as BaseContext & T;
  };
}

// Basic hook for general use - requires type parameter
export const useBaseReforge = () => React.useContext(ReforgeContext);

// General hook that returns the context with any explicit type
export const useReforge = (): ProvidedContext => useBaseReforge() as unknown as ProvidedContext;

let globalReforgeIsTaken = false;

export const assignReforgeClient = () => {
  if (globalReforgeIsTaken) {
    return new Reforge();
  }

  globalReforgeIsTaken = true;
  return reforge;
};

export type ReforgeProviderProps = SharedSettings & {
  sdkKey: string;
  contextAttributes?: ContextAttributes;
};

const getContext = (
  contextAttributes: ContextAttributes,
  onError: (e: Error) => void
): [Context, string] => {
  try {
    if (Object.keys(contextAttributes).length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "ReforgeProvider: You haven't passed any contextAttributes. See https://docs.prefab.cloud/docs/sdks/react#using-context"
      );
    }

    const context = new Context(contextAttributes);
    const contextKey = context.encode();

    return [context, contextKey];
  } catch (e) {
    onError(e as Error);
    return [new Context({}), ""];
  }
};

function ReforgeProvider({
  sdkKey,
  contextAttributes = {},
  onError = (e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(e);
  },
  children,
  timeout,
  endpoints,
  apiEndpoint,
  pollInterval,
  afterEvaluationCallback = undefined,
  collectEvaluationSummaries,
  collectLoggerNames,
  collectContextMode,
}: PropsWithChildren<ReforgeProviderProps>) {
  const settings = {
    sdkKey,
    endpoints,
    apiEndpoint,
    timeout,
    pollInterval,
    onError,
    afterEvaluationCallback,
    collectEvaluationSummaries,
    collectLoggerNames,
    collectContextMode,
  };

  // We use this state to prevent a double-init when useEffect fires due to
  // StrictMode
  const mostRecentlyLoadingContextKey = React.useRef<string | undefined>(undefined);
  // We use this state to pass the loading state to the Provider (updating
  // currentLoadingContextKey won't trigger an update)
  const [loading, setLoading] = React.useState(true);
  // Here we track the current identity so we can reload our config when it
  // changes
  const [loadedContextKey, setLoadedContextKey] = React.useState("");

  const reforgeClient: Reforge = React.useMemo(() => assignReforgeClient(), []);

  const [context, contextKey] = getContext(contextAttributes, onError);

  React.useEffect(() => {
    if (mostRecentlyLoadingContextKey.current === contextKey) {
      return;
    }

    setLoading(true);
    try {
      if (mostRecentlyLoadingContextKey.current === undefined) {
        mostRecentlyLoadingContextKey.current = contextKey;

        if (!sdkKey) {
          throw new Error("ReforgeProvider: sdkKey is required");
        }

        const initOptions: Parameters<typeof reforgeClient.init>[0] = {
          context,
          ...settings,
          clientNameString: "sdk-react",
          clientVersionString: version,
        };

        reforgeClient
          .init(initOptions)
          .then(() => {
            setLoadedContextKey(contextKey);
            setLoading(false);

            if (pollInterval) {
              reforgeClient.poll({ frequencyInMs: pollInterval });
            }
          })
          .catch((reason: any) => {
            setLoading(false);
            onError(reason);
          });
      } else {
        mostRecentlyLoadingContextKey.current = contextKey;

        reforgeClient
          .updateContext(context)
          .then(() => {
            setLoadedContextKey(contextKey);
            setLoading(false);
          })
          .catch((reason: any) => {
            setLoading(false);
            onError(reason);
          });
      }
    } catch (e) {
      setLoading(false);
      onError(e as Error);
    }
  }, [
    sdkKey,
    loadedContextKey,
    contextKey,
    loading,
    setLoading,
    onError,
    reforgeClient.instanceHash,
  ]);

  const value = React.useMemo(() => {
    const baseContext: ProvidedContext = {
      isEnabled: reforgeClient.isEnabled.bind(reforgeClient),
      contextAttributes,
      get: reforgeClient.get.bind(reforgeClient),
      getDuration: reforgeClient.getDuration.bind(reforgeClient),
      keys: Object.keys(reforgeClient.extract()),
      reforge: reforgeClient,
      loading,
      settings,
    };

    return baseContext;
  }, [loadedContextKey, loading, reforgeClient.instanceHash, settings]);

  return <ReforgeContext.Provider value={value}>{children}</ReforgeContext.Provider>;
}

export { ReforgeProvider, ConfigValue, ContextAttributes, SharedSettings, ReforgeTypesafeClass };
