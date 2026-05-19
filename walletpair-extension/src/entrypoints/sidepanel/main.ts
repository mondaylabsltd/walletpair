import { mount } from 'svelte';
import App from './App.svelte';
import './sidepanel.css';

mount(App, { target: document.getElementById('app')! });
