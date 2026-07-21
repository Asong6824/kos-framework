import { readStoredCredential } from "../core/auth-storage.ts";

export type ConfigurableWebSearchProvider = "brave" | "exa";

export function webSearchCredentialId(provider: ConfigurableWebSearchProvider): string {
	return `kos-web-search-${provider}`;
}

export function readWebSearchApiKey(provider: ConfigurableWebSearchProvider): string | undefined {
	const credential = readStoredCredential(webSearchCredentialId(provider));
	if (credential?.type !== "api_key") return undefined;
	const key = credential.key?.trim();
	return key || undefined;
}

export function getWebSearchConfigurationState(): Record<ConfigurableWebSearchProvider, boolean> {
	return { brave: !!readWebSearchApiKey("brave"), exa: !!readWebSearchApiKey("exa") };
}
