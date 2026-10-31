/**
 * Close the soft keyboard.
 *
 * A WebView has no keyboard API of its own here, and `interactive-widget=
 * resizes-content` makes the layout shrink rather than scroll — so an input that
 * keeps focus keeps the keyboard up and the sheet stays half-height. Blurring
 * the focused field is the whole mechanism; nothing else needs to happen.
 *
 * Deliberately not a `@capacitor/keyboard` dependency: that plugin exists to
 * control *when* the keyboard shows, and the only thing this app needs is "get
 * out of the way once the field is done".
 *
 * WHY IT BLURS THREE TIMES: removing the focused element — committing a subtask
 * unmounts its input — does not leave nothing focused. The browser hands focus
 * to the next focusable control, which in the task sheet is the Title field, so
 * one blur closes the keyboard and the re-render immediately reopens it on a
 * different input. Blurring again once the render has settled is what actually
 * dismisses it; measured on the phone, one blur left the keyboard up.
 */
function blurActiveElement(): void {
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export function dismissKeyboard(): void {
	blurActiveElement();
	requestAnimationFrame(blurActiveElement);
	setTimeout(blurActiveElement, 60);
}
