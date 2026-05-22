import {
  EnvironmentAirQualityRisk,
  EnvironmentHumidityBand,
  EnvironmentSeason,
  EnvironmentTemperatureBand,
  EnvironmentUvRisk,
} from './environment-intelligence.constants';
import {
  classifyAirQuality,
  classifyHumidity,
  classifyTemperature,
  classifyUv,
  deriveSeason,
} from './environment-classifiers';

describe('environment classifiers', () => {
  it.each([
    [null, null],
    [-5, EnvironmentTemperatureBand.Freezing],
    [0, EnvironmentTemperatureBand.Freezing],
    [1, EnvironmentTemperatureBand.Cold],
    [10, EnvironmentTemperatureBand.Mild],
    [22, EnvironmentTemperatureBand.Warm],
    [30, EnvironmentTemperatureBand.Hot],
  ] as const)('classifies temperature %s', (value, expected) => {
    expect(classifyTemperature(value)).toBe(expected);
  });

  it.each([
    [null, null],
    [29, EnvironmentHumidityBand.VeryDry],
    [30, EnvironmentHumidityBand.Dry],
    [45, EnvironmentHumidityBand.Balanced],
    [65, EnvironmentHumidityBand.Balanced],
    [66, EnvironmentHumidityBand.Humid],
    [80, EnvironmentHumidityBand.Humid],
    [81, EnvironmentHumidityBand.VeryHumid],
  ] as const)('classifies humidity %s', (value, expected) => {
    expect(classifyHumidity(value)).toBe(expected);
  });

  it.each([
    [null, EnvironmentUvRisk.Unknown],
    [2, EnvironmentUvRisk.Low],
    [3, EnvironmentUvRisk.Moderate],
    [6, EnvironmentUvRisk.High],
    [8, EnvironmentUvRisk.VeryHigh],
    [11, EnvironmentUvRisk.Extreme],
  ] as const)('classifies UV index %s', (value, expected) => {
    expect(classifyUv(value)).toBe(expected);
  });

  it.each([
    [null, EnvironmentAirQualityRisk.Unknown],
    [20, EnvironmentAirQualityRisk.Good],
    [21, EnvironmentAirQualityRisk.Fair],
    [41, EnvironmentAirQualityRisk.Moderate],
    [61, EnvironmentAirQualityRisk.Poor],
    [101, EnvironmentAirQualityRisk.VeryPoor],
  ] as const)('classifies air quality %s', (value, expected) => {
    expect(classifyAirQuality(value)).toBe(expected);
  });

  it.each([
    ['2026-03-01', 59, EnvironmentSeason.Spring],
    ['2026-06-01', 59, EnvironmentSeason.Summer],
    ['2026-09-01', 59, EnvironmentSeason.Autumn],
    ['2026-12-01', 59, EnvironmentSeason.Winter],
    ['2026-03-01', -33, EnvironmentSeason.Autumn],
    ['2026-06-01', -33, EnvironmentSeason.Winter],
    ['2026-09-01', -33, EnvironmentSeason.Spring],
    ['2026-12-01', -33, EnvironmentSeason.Summer],
    ['2026-12-01', null, EnvironmentSeason.Winter],
  ] as const)(
    'derives season for %s at latitude %s',
    (date, latitude, expected) => {
      expect(deriveSeason(date, latitude)).toBe(expected);
    },
  );
});
