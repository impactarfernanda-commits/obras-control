type PublicBuildEnv = {
  VITE_BUILD_SHA?: string;
};

const publicBuildEnv = (import.meta as ImportMeta & { env?: PublicBuildEnv }).env;

export const BUILD_SHA = publicBuildEnv?.VITE_BUILD_SHA?.trim() || "local";
export const BUILD_SHORT_SHA = BUILD_SHA === "local" ? BUILD_SHA : BUILD_SHA.slice(0, 7);
