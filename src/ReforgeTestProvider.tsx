import React, { PropsWithChildren } from "react";
import {
  ReforgeContext,
  assignReforgeClient,
  ProvidedContext,
  ReforgeTypesafeClass,
  extractTypesafeMethods,
} from "./ReforgeProvider";

export type TestProps = {
  config: Record<string, any>;
  apiKey?: string;
};

function ReforgeTestProvider<T = any>({
  apiKey,
  config,
  children,
  ReforgeTypesafeClass: TypesafeClass,
}: PropsWithChildren<TestProps & { ReforgeTypesafeClass?: ReforgeTypesafeClass<T> }>) {
  const get = (key: string) => config[key];
  const getDuration = (key: string) => config[key];
  const isEnabled = (key: string) => !!get(key);

  const reforgeClient = React.useMemo(() => assignReforgeClient(), []);

  // Memoize typesafe instance separately
  const typesafeInstance = React.useMemo(() => {
    if (TypesafeClass && reforgeClient) {
      return new TypesafeClass(reforgeClient);
    }
    return null;
  }, [TypesafeClass, reforgeClient]);

  const value = React.useMemo(() => {
    reforgeClient.get = get;
    reforgeClient.getDuration = getDuration;
    reforgeClient.isEnabled = isEnabled;

    const baseContext: ProvidedContext = {
      isEnabled,
      contextAttributes: config.contextAttributes,
      get,
      getDuration,
      loading: false,
      reforge: reforgeClient,
      keys: Object.keys(config),
      settings: { apiKey: apiKey ?? "fake-api-key-via-the-test-provider" },
    };

    if (typesafeInstance) {
      const methods = extractTypesafeMethods(typesafeInstance);
      return { ...baseContext, ...methods };
    }

    return baseContext;
  }, [config, reforgeClient, typesafeInstance, apiKey]);

  return <ReforgeContext.Provider value={value}>{children}</ReforgeContext.Provider>;
}

export { ReforgeTestProvider };
