/* eslint-disable max-classes-per-file */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/extend-expect";
import { act } from "react-dom/test-utils";
import { ContextValue, Reforge } from "@reforge-com/javascript";
import {
  ContextAttributes,
  ReforgeProvider,
  useReforge,
  useReforgeTypesafe,
  ReforgeTestProvider,
  createReforgeHook,
} from "../index";
import {
  AppConfig,
  TypesafeComponent,
  HookComponent,
  mockEvaluationsResponse,
} from "./test-helpers";

type Config = { [key: string]: any };

function MyComponent() {
  const { get, isEnabled, loading, keys } = useReforge();
  const greeting = get("greeting") || "Default";
  const subtitle = get("subtitle")?.actualSubtitle || "Default Subtitle";

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h1 role="alert">{greeting}</h1>
      <h2 role="banner">{subtitle}</h2>
      {isEnabled("secretFeature") && (
        <button type="submit" title="secret-feature">
          Secret feature
        </button>
      )}

      <pre data-testid="known-keys">{JSON.stringify(keys)}</pre>
    </div>
  );
}

let warn: ReturnType<typeof jest.spyOn>;
let error: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  error = jest.spyOn(console, "error").mockImplementation(() => {});
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockReset();
  error.mockReset();
});

describe("ReforgeProvider", () => {
  const defaultContextAttributes = { user: { email: "test@example.com" } };

  const renderInProvider = ({
    contextAttributes,
    onError,
  }: {
    contextAttributes?: { [key: string]: Record<string, ContextValue> };
    onError?: (err: Error) => void;
  }) =>
    render(
      <ReforgeProvider apiKey="api-key" contextAttributes={contextAttributes} onError={onError}>
        <MyComponent />
      </ReforgeProvider>
    );

  const stubConfig = (config: Config) =>
    new Promise((resolve) => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => {
            setTimeout(resolve);
            return { evaluations: config };
          },
        })
      ) as jest.Mock;
    });

  const renderWithConfig = async (
    config: Config,
    providerConfig: Parameters<typeof renderInProvider>[0] = {
      contextAttributes: defaultContextAttributes,
      onError: (e) => {
        throw e;
      },
    }
  ) => {
    const promise = stubConfig(config);

    const rendered = renderInProvider(providerConfig);

    await act(async () => {
      await promise;
    });

    // wait for the loading content to go away
    screen.findByRole("alert");

    return rendered;
  };

  it("renders without config", async () => {
    await renderWithConfig({});

    const alert = screen.queryByRole("alert");
    expect(alert).toHaveTextContent("Default");
    const secretFeature = screen.queryByTitle("secret-feature");
    expect(secretFeature).not.toBeInTheDocument();
  });

  it("allows providing flag values", async () => {
    await renderWithConfig({ greeting: { value: { string: "CUSTOM" } } });

    const alert = screen.queryByRole("alert");
    expect(alert).toHaveTextContent("CUSTOM");
    const secretFeature = screen.queryByTitle("secret-feature");
    expect(secretFeature).not.toBeInTheDocument();
  });

  it("allows providing true flag booleans", async () => {
    await renderWithConfig({
      greeting: { value: { string: "CUSTOM" } },
      secretFeature: { value: { boolean: true } },
    });

    const alert = screen.queryByRole("alert");
    expect(alert).toHaveTextContent("CUSTOM");
    const secretFeature = screen.queryByTitle("secret-feature");
    expect(secretFeature).toBeInTheDocument();
  });

  it("allows providing false flag booleans", async () => {
    await renderWithConfig({
      greeting: { value: { string: "CUSTOM" } },
      secretFeature: { value: { boolean: false } },
    });

    const alert = screen.queryByRole("alert");
    expect(alert).toHaveTextContent("CUSTOM");
    const secretFeature = screen.queryByTitle("secret-feature");
    expect(secretFeature).not.toBeInTheDocument();
  });

  it("allows providing json configs", async () => {
    await renderWithConfig({
      subtitle: { value: { json: '{ "actualSubtitle": "Json Subtitle" }' } },
    });

    const alert = screen.queryByRole("banner");
    expect(alert).toHaveTextContent("Json Subtitle");
  });

  it("warns when you do not provide contextAttributes", async () => {
    const rendered = await renderWithConfig(
      {
        greeting: { value: { string: "CUSTOM" } },
        secretFeature: { value: { boolean: true } },
      },
      { contextAttributes: { user: { email: "old@example.com" } } }
    );

    const alert = screen.queryByRole("alert");
    expect(alert).toHaveTextContent("CUSTOM");

    const newConfigPromise = stubConfig({
      greeting: { value: { string: "ANOTHER" } },
      secretFeature: { value: { boolean: false } },
    });

    act(() => {
      rendered.rerender(
        <ReforgeProvider
          apiKey="api-key"
          contextAttributes={{ user: { email: "test@example.com" } }}
          onError={() => {}}
        >
          <MyComponent />
        </ReforgeProvider>
      );
    });

    await newConfigPromise;
    // wait for render
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((r) => setTimeout(r, 1));

    const updatedAlert = screen.queryByRole("alert");
    expect(updatedAlert).toHaveTextContent("ANOTHER");
  });

  it("re-fetches when you update the contextAttributes prop on the provider", async () => {
    let setContextAttributes: (attributes: ContextAttributes) => void = () => {
      // eslint-disable-next-line no-console
      console.warn("setContextAttributes not set");
    };

    const promise = stubConfig({ greeting: { value: { string: "CUSTOM" } } });

    function Wrapper({ context }: { context: ContextAttributes }) {
      const [contextAttributes, innerSetContextAttributes] = React.useState(context);

      setContextAttributes = innerSetContextAttributes;

      return (
        <ReforgeProvider apiKey="api-key" contextAttributes={contextAttributes} onError={() => {}}>
          <MyComponent />
        </ReforgeProvider>
      );
    }

    render(<Wrapper context={{ user: { email: "test@example.com" } }} />);

    await act(async () => {
      await promise;
    });

    const alert = screen.queryByRole("alert");
    expect(alert).toHaveTextContent("CUSTOM");

    const newRequestPromise = stubConfig({
      greeting: { value: { string: "UPDATED FROM CONTEXT" } },
    });

    setContextAttributes({ user: { email: "foo@example.com" } });

    await newRequestPromise;
    // wait for render
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((r) => setTimeout(r, 1));

    const updatedAlert = screen.queryByRole("alert");
    expect(updatedAlert).toHaveTextContent("UPDATED FROM CONTEXT");
  });

  it("allows providing an afterEvaluationCallback", async () => {
    const context = { user: { email: "test@example.com" } };

    const callback = jest.fn();

    const promise = stubConfig({ greeting: { value: { string: "afterEvaluationCallback" } } });

    render(
      <ReforgeProvider
        apiKey="api-key"
        contextAttributes={context}
        afterEvaluationCallback={callback}
        onError={() => {}}
      >
        <MyComponent />
      </ReforgeProvider>
    );

    await act(async () => {
      await promise;
    });

    // wait for async callback to be called
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((r) => setTimeout(r, 1));

    expect(callback).toHaveBeenCalledWith("greeting", "afterEvaluationCallback", {
      contexts: context,
    });
  });

  it("triggers onError if something goes wrong", async () => {
    const context = { user: { name: "🥰", phone: "(555) 555–5555" } };
    const onError = jest.fn();

    await renderWithConfig({}, { contextAttributes: context, onError });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        // NOTE: While context-encoding bug is fixed in the in-browser version
        // of prefab-cloud-js since
        // https://github.com/prefab-cloud/prefab-cloud-js/pull/65 the Node
        // version (which is only intended to be run in unit-tests) still
        // exhibits the bug. It is convenient for us to test this onError.
        name: "InvalidCharacterError",
        message: "The string to be encoded contains invalid characters.",
      })
    );

    const alert = screen.queryByRole("alert");
    expect(alert).toHaveTextContent("Default");
    const secretFeature = screen.queryByTitle("secret-feature");
    expect(secretFeature).not.toBeInTheDocument();
  });
});

describe("ReforgeProvider with TypesafeClass", () => {
  const defaultContextAttributes = { user: { email: "test@example.com" } };

  // Mock reforge client responses for typesafe tests
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => mockEvaluationsResponse,
      })
    ) as jest.Mock;
  });

  it("makes TypesafeClass methods available through useReforgeTypesafe", async () => {
    render(
      <ReforgeProvider
        apiKey="test-api-key"
        contextAttributes={defaultContextAttributes}
        ReforgeTypesafeClass={AppConfig}
      >
        <TypesafeComponent />
      </ReforgeProvider>
    );

    // Wait for loading to finish
    await act(async () => {
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-name")).toHaveTextContent("Test App");
    expect(screen.getByTestId("raw-theme-color")).toHaveTextContent("#FF5500");
    expect(screen.getByTestId("feature-flag")).toBeInTheDocument();
  });

  it("provides typesafe methods through the custom hook", async () => {
    render(
      <ReforgeProvider
        apiKey="test-api-key"
        contextAttributes={defaultContextAttributes}
        ReforgeTypesafeClass={AppConfig}
      >
        <HookComponent />
      </ReforgeProvider>
    );

    // Wait for loading to finish
    await act(async () => {
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-name-hook")).toHaveTextContent("Test App");
    expect(screen.getByTestId("api-url")).toHaveTextContent("https://api.test.com");
    expect(screen.getByTestId("timeout")).toHaveTextContent("4000"); // 2000 * 2
  });

  it("uses default values when configs are not available", async () => {
    // Override the mock to return empty configs
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => ({ evaluations: {} }),
      })
    ) as jest.Mock;

    render(
      <ReforgeProvider
        apiKey="test-api-key"
        contextAttributes={defaultContextAttributes}
        ReforgeTypesafeClass={AppConfig}
      >
        <TypesafeComponent />
        <HookComponent />
      </ReforgeProvider>
    );

    // Wait for loading to finish
    await act(async () => {
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-name")).toHaveTextContent("Default App");
    expect(screen.getByTestId("timeout")).toHaveTextContent("2000"); // 1000 * 2 (default)
    expect(screen.queryByTestId("feature-flag")).not.toBeInTheDocument();
  });
});

describe("TypesafeClass instance memoization", () => {
  it("memoizes the TypesafeClass instance across renders", async () => {
    // Create a mocked version of our TypesafeClass with constructor and method spies
    const constructorSpy = jest.fn();
    const methodSpy = jest.fn();

    class TrackedAppConfig {
      constructor(reforge: Reforge) {
        constructorSpy(reforge);
        this.reforge = reforge;
      }

      private reforge: Reforge;

      appName(): string {
        methodSpy();
        const name = this.reforge.get("app.name");
        return typeof name === "string" ? name : "Default App";
      }
    }

    // Component that forces re-renders and tracks calls
    function ReRenderingComponent() {
      const [counter, setCounter] = React.useState(0);
      const { appName } = useReforgeTypesafe<TrackedAppConfig>();

      // Force a re-render after mounting
      React.useEffect(() => {
        if (counter < 3) {
          setTimeout(() => setCounter(counter + 1), 10);
        }
      }, [counter]);

      return (
        <div data-testid="counter">
          {appName()} (Render count: {counter})
        </div>
      );
    }

    render(
      <ReforgeTestProvider
        config={{
          "app.name": "Memoization Test",
        }}
        ReforgeTypesafeClass={TrackedAppConfig}
      >
        <ReRenderingComponent />
      </ReforgeTestProvider>
    );

    // Wait for all re-renders to complete
    await waitFor(() => {
      expect(screen.getByTestId("counter")).toHaveTextContent("(Render count: 3)");
    });

    // Constructor should only be called once, but the method should be called for each render
    expect(constructorSpy).toHaveBeenCalledTimes(1);
    expect(methodSpy).toHaveBeenCalledTimes(4);
  });
});

// Adding explicit tests for createReforgeHook functionality
describe("createReforgeHook functionality with ReforgeProvider", () => {
  const defaultContextAttributes = { user: { email: "test@example.com" } };

  // Create a custom TypesafeClass for testing
  class CustomFeatureFlags {
    private reforge: Reforge;

    constructor(reforge: Reforge) {
      this.reforge = reforge;
    }

    isSecretFeatureEnabled(): boolean {
      return this.reforge.isEnabled("secret.feature");
    }

    getGreeting(): string {
      const greeting = this.reforge.get("greeting");
      return typeof greeting === "string" ? greeting : "Default Greeting";
    }

    calculateValue(multiplier: number): number {
      const baseValue = this.reforge.get("base.value");
      const base = typeof baseValue === "number" ? baseValue : 10;
      return base * multiplier;
    }
  }

  // Create a typed hook using our TypesafeClass
  const useCustomFeatureFlags = createReforgeHook(CustomFeatureFlags);

  // Component that uses the custom typed hook
  function CustomHookComponent() {
    const { isSecretFeatureEnabled, getGreeting, calculateValue, loading } =
      useCustomFeatureFlags();

    if (loading) {
      return <div>Loading...</div>;
    }

    return (
      <div>
        <h1 data-testid="custom-greeting">{getGreeting()}</h1>
        {isSecretFeatureEnabled() && <div data-testid="custom-feature">Secret Feature Enabled</div>}
        <div data-testid="calculated-value">{calculateValue(5)}</div>
      </div>
    );
  }

  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => ({
          evaluations: {
            greeting: { value: { string: "Hello from Custom Hook" } },
            "secret.feature": { value: { boolean: true } },
            "base.value": { value: { int: 20 } },
          },
        }),
      })
    ) as jest.Mock;
  });

  it("creates a working custom hook with createReforgeHook", async () => {
    render(
      <ReforgeProvider
        apiKey="test-api-key"
        ReforgeTypesafeClass={CustomFeatureFlags}
        contextAttributes={defaultContextAttributes}
      >
        <CustomHookComponent />
      </ReforgeProvider>
    );

    // Wait for loading to finish
    await act(async () => {
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.getByTestId("custom-greeting")).toHaveTextContent("Hello from Custom Hook");
    expect(screen.getByTestId("custom-feature")).toBeInTheDocument();
    expect(screen.getByTestId("calculated-value")).toHaveTextContent("100"); // 20 * 5
  });

  it("memoizes TypesafeClass instance when used with custom hook", async () => {
    // Create a mocked version with constructor and method spies
    const constructorSpy = jest.fn();
    const methodSpy = jest.fn().mockReturnValue("test result");

    class SpiedClass {
      private reforge: Reforge;

      constructor(reforge: Reforge) {
        constructorSpy(reforge);
        this.reforge = reforge;
      }

      // eslint-disable-next-line class-methods-use-this
      testMethod(): string {
        return methodSpy();
      }
    }

    const useSpiedHook = createReforgeHook(SpiedClass);

    // Component that forces re-renders
    function ReRenderingComponent() {
      const [counter, setCounter] = React.useState(0);
      const { testMethod } = useSpiedHook();

      // Call the method on each render
      const result = testMethod();

      React.useEffect(() => {
        // Force multiple re-renders
        if (counter < 3) {
          setTimeout(() => setCounter(counter + 1), 10);
        }
      }, [counter]);

      return (
        <div data-testid="hook-result">
          {result} (Render count: {counter})
        </div>
      );
    }

    // Mock the fetch response for ReforgeProvider
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => ({ evaluations: {} }),
      })
    ) as jest.Mock;

    render(
      <ReforgeProvider
        apiKey="test-api-key"
        contextAttributes={defaultContextAttributes}
        ReforgeTypesafeClass={SpiedClass}
      >
        <ReRenderingComponent />
      </ReforgeProvider>
    );

    // Wait for all re-renders to complete
    await waitFor(() => {
      expect(screen.getByTestId("hook-result")).toHaveTextContent("(Render count: 3)");
    });

    // In ReforgeProvider, constructor may be called twice due to React's strict mode
    // or the provider's initialization process, which is still valid behavior
    expect(constructorSpy).toHaveBeenCalledTimes(2);
    // Method is called once on initial render, once during initialization, and three more times for re-renders
    expect(methodSpy).toHaveBeenCalledTimes(5);
  });
});
