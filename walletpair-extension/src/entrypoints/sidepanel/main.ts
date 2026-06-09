import { mount } from 'svelte';
// Reuse the popup App component — same UI, different container size
import App from '../popup/App.svelte';
import './sidepanel.css';

mount(App, { target: document.getElementById('app')! });
