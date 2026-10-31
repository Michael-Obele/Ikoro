/** Battery-saver facts for the reliability banner. Every function no-ops off Android, so the banner needs no platform branch. */
import { Capacitor } from '@capacitor/core';
import { IkoroAlarm, type IkoroBatteryStatus } from './plugin';

function supported(): boolean {
	return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function batteryStatus(): Promise<IkoroBatteryStatus | null> {
	if (!supported()) return null;
	try {
		return await IkoroAlarm.getBatteryStatus();
	} catch (error) {
		console.warn('[ikoro] battery status read failed', error);
		return null;
	}
}

/** Show the system dialog that exempts Ikoro from battery optimisation. */
export async function requestBatteryExemption(): Promise<void> {
	if (!supported()) return;
	try {
		await IkoroAlarm.requestIgnoreBatteryOptimizations();
	} catch (error) {
		console.warn('[ikoro] could not request the battery exemption', error);
	}
}

/** Open the system battery-saver screen — an app cannot switch saver off itself. */
export async function openBatterySaverSettings(): Promise<void> {
	if (!supported()) return;
	try {
		await IkoroAlarm.openBatterySaverSettings();
	} catch (error) {
		console.warn('[ikoro] could not open battery saver settings', error);
	}
}
