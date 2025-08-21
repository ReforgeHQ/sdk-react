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
export interface ReactHookConfigurationRaw extends Record<string, unknown> {}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ReactHookConfigurationAccessor extends Record<string, unknown> {}

type ContextValue = number | string | boolean;
type ContextAttributes = Record<string, Record<string, ContextValue>>;
type EvaluationCallback = (key: string, value: ConfigValue, context: Context | undefined) => void;

type ClassMethods<T> = { [K in keyof T]: T[K] };

type ReforgeTypesafeClass<T = unknown> = new (reforgeInstance: Reforge) => T;

type SharedSettings = {
  apiKey?: string;
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

// Extract base context without ClassMethods
export type BaseContext = {
  get: (
    key: keyof ReactHookConfigurationRaw & string
  ) => ReactHookConfigurationRaw[keyof ReactHookConfigurationRaw];
  getDuration(key: string): Duration | undefined;
  contextAttributes: ContextAttributes;
  isEnabled: (key: string) => boolean;
  loading: boolean;
  reforge: typeof reforge;
  keys: string[];
  settings: SharedSettings;
};

export type ProvidedContext = BaseContext & ClassMethods<ReactHookConfigurationAccessor>;

export const defaultContext: BaseContext = {
  get: (_key: string) => undefined,
  getDuration: (_key: string) => undefined,
  isEnabled: (_key: string) => false,
  keys: [] as string[],
  loading: true,
  contextAttributes: {},
  reforge,
  settings: {},
};

export const ReforgeContext = React.createContext<ProvidedContext>(
  defaultContext as ProvidedContext
);

// This is a factory function that creates a fully typed useReforge hook for a specific ReforgeTypesafe class
export function createReforgeHook<T>(_typesafeClass: ReforgeTypesafeClass<T>) {
  return function useReforgeHook(): BaseContext & T {
    const context = React.useContext(ReforgeContext);
    return context as BaseContext & T;
  };
}

// Basic hook for general use - requires type parameter
export const useBaseReforge = () => React.useContext(ReforgeContext);

// Helper hook for explicit typing
export function useReforgeTypesafe<T>(): BaseContext & T {
  return useBaseReforge() as BaseContext & T;
}

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
  apiKey: string;
  contextAttributes?: ContextAttributes;
  ReforgeTypesafeClass?: ReforgeTypesafeClass<any>;
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

// Helper to extract methods from a TypesafeClass instance
export const extractTypesafeMethods = (
  instance: Record<string, unknown>
): Record<string, unknown> => {
  const methods: Record<string, unknown> = {};
  const prototype = Object.getPrototypeOf(instance);

  const descriptors = Object.getOwnPropertyDescriptors(prototype);

  Object.keys(descriptors).forEach((key) => {
    if (key === "constructor") return;

    const descriptor = descriptors[key];

    // Handle regular methods
    if (typeof instance[key] === "function") {
      methods[key] = (instance[key] as () => unknown).bind(instance);
    }
    // Handle getters - convert to regular properties
    else if (descriptor.get) {
      methods[key] = instance[key];
    }
  });

  return methods;
};

function ReforgeProvider({
  apiKey,
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
  ReforgeTypesafeClass: TypesafeClass,
}: PropsWithChildren<ReforgeProviderProps>) {
  const settings = {
    apiKey,
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

        if (!apiKey) {
          throw new Error("ReforgeProvider: apiKey is required");
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
    apiKey,
    loadedContextKey,
    contextKey,
    loading,
    setLoading,
    onError,
    reforgeClient.instanceHash,
  ]);

  // Memoize typesafe instance separately
  const typesafeInstance = React.useMemo(() => {
    if (TypesafeClass && reforgeClient) {
      return new TypesafeClass(reforgeClient);
    }
    return null;
  }, [TypesafeClass, reforgeClient.instanceHash, loading]);

  const value = React.useMemo(() => {
    const baseContext: ProvidedContext = {
      isEnabled: reforgeClient.isEnabled.bind(reforgeClient),
      contextAttributes,
      get: reforgeClient.get.bind(reforgeClient),
      getDuration: reforgeClient.getDuration.bind(reforgeClient),
      keys: Object.keys(reforgeClient.configs),
      reforge: reforgeClient,
      loading,
      settings,
    };

    if (typesafeInstance) {
      const methods = extractTypesafeMethods(typesafeInstance);
      return { ...baseContext, ...methods } as ProvidedContext;
    }

    return baseContext;
  }, [loadedContextKey, loading, reforgeClient.instanceHash, settings, typesafeInstance]);

  return <ReforgeContext.Provider value={value}>{children}</ReforgeContext.Provider>;
}

export { ReforgeProvider, ConfigValue, ContextAttributes, SharedSettings, ReforgeTypesafeClass };
