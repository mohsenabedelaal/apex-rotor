import { App } from './client/App';
import './client/styles.css';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('App root element was not found.');
}

App(root);
