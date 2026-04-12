
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	type MatcherParam<M> = M extends (param : string) => param is (infer U extends string) ? U : string;

	export interface AppTypes {
		RouteId(): "/" | "/api" | "/api/flight-lookup" | "/api/geocode" | "/api/predict-flight" | "/api/predict" | "/api/reverse-geocode";
		RouteParams(): {
			
		};
		LayoutParams(): {
			"/": Record<string, never>;
			"/api": Record<string, never>;
			"/api/flight-lookup": Record<string, never>;
			"/api/geocode": Record<string, never>;
			"/api/predict-flight": Record<string, never>;
			"/api/predict": Record<string, never>;
			"/api/reverse-geocode": Record<string, never>
		};
		Pathname(): "/" | "/api/flight-lookup" | "/api/geocode" | "/api/predict-flight" | "/api/predict" | "/api/reverse-geocode";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/manifest.webmanifest" | "/service-worker.js" | string & {};
	}
}