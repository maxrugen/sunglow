import type { SkyEvent } from '$lib/types';

/** User-facing wording per event, so components don't hard-code "sunset". */
export const EVENT_COPY: Record<
  SkyEvent,
  {
    noun: string;
    title: string;
    icon: string;
    /** "toward the {sunAdjective} sun" */
    sunAdjective: string;
    tagline: string;
    goldenHourLabel: string;
    dayPassedNote: string;
  }
> = {
  sunset: {
    noun: 'sunset',
    title: 'Sunset',
    icon: '🌇',
    sunAdjective: 'setting',
    tagline: "Predict tonight's sunset quality",
    goldenHourLabel: 'Golden Hour',
    dayPassedNote: "Tonight's sunset has passed, so this is the forecast for tomorrow.",
  },
  sunrise: {
    noun: 'sunrise',
    title: 'Sunrise',
    icon: '🌅',
    sunAdjective: 'rising',
    tagline: 'Predict the quality of the next sunrise',
    goldenHourLabel: 'Golden hour ends',
    dayPassedNote: "This morning's sunrise has passed, so this is the forecast for tomorrow.",
  },
};

export const SKY_EVENTS: SkyEvent[] = ['sunset', 'sunrise'];

export function isSkyEvent(value: unknown): value is SkyEvent {
  return value === 'sunset' || value === 'sunrise';
}
