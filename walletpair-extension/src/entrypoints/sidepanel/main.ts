import { mount } from 'svelte';
// Reuse the popup App component — same UI, different container size
import App from '../popup/App.svelte';
import './sidepanel.css';

// Tell the background the panel is now visible so it clears the toolbar badge
// hint (shown when a dApp connect couldn't auto-open the panel).
chrome.runtime.sendMessage({ action: 'ui-opened' }).catch(() => {});

mount(App, { target: document.getElementById('app')! });
