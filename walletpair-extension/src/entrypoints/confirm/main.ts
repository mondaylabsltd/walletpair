import { mount } from 'svelte';
import App from './App.svelte';
import '../popup/app.css';

mount(App, { target: document.getElementById('app')! });
