declare module "swagger-ui-react" {
  type SwaggerPlugin = (...args: any[]) => any;

  type SwaggerUIProps = {
    spec?: Record<string, unknown>;
    onComplete?: (system: any) => void;
    plugins?: SwaggerPlugin[];
    docExpansion?: "list" | "full" | "none";
    deepLinking?: boolean;
    tryItOutEnabled?: boolean;
    filter?: boolean | string;
    displayRequestDuration?: boolean;
    validatorUrl?: string | null;
    defaultModelsExpandDepth?: number;
    defaultModelExpandDepth?: number;
    supportedSubmitMethods?: string[];
    showExtensions?: boolean;
    showCommonExtensions?: boolean;
  };

  const SwaggerUI: import("react").ComponentType<SwaggerUIProps>;
  export default SwaggerUI;
}

declare module "swagger-ui-react/swagger-ui.css";
