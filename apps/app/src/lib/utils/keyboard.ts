/**
 * Close the soft keyboard by blurring the focused field.
 * Three times: removing a focused element hands focus to the next control, which reopens it.
 */
function blurActiveElement(): void {
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export function dismissKeyboard(): void {
	blurActiveElement();
	requestAnimationFrame(blurActiveElement);
	setTimeout(blurActiveElement, 60);
}
