import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { trackDirective } from './directives/track'

const app = createApp(App)
app.use(createPinia())
app.directive('track', trackDirective)
app.mount('#app')
