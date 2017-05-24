import { attributeChangedCallback } from './attribute-changed';
import { ConfigApi, LoadComponentData, PlatformApi, ProxyElement, RendererApi } from '../util/interfaces';
import { connectedCallback } from './connected';
import { disconnectedCallback } from './disconnected';
import { getObservedAttributes } from './registry-client';
import { initLoadComponent, queueUpdate } from './update';


export function registerComponentsES5(renderer: RendererApi, plt: PlatformApi, config: ConfigApi, components: LoadComponentData[]) {

  plt.registerComponents(components).forEach(cmpMeta => {
    function ProxyHTMLElement(self: any) {
      return HTMLElement.call(this, self);
    }

    ProxyHTMLElement.prototype = Object.create(
      HTMLElement.prototype,
      {
        constructor: { value: ProxyHTMLElement, configurable: true },

        connectedCallback: { configurable: true, value:
          function() {
            connectedCallback(plt, config, renderer, this, cmpMeta);
          }
        },

        attributeChangedCallback: { configurable: true, value:
          function(attrName: string, oldVal: string, newVal: string) {
            attributeChangedCallback(this, cmpMeta, attrName, oldVal, newVal);
          }
        },

        disconnectedCallback: { configurable: true, value:
          function() {
            disconnectedCallback(plt, this);
          }
        },

        $queueUpdate: { configurable: true, value:
          function() {
            queueUpdate(plt, config, renderer, this, cmpMeta.tag);
          }
        },

        $initLoadComponent: { configurable: true, value:
          function() {
            initLoadComponent(plt, cmpMeta.listeners, this, (<ProxyElement>this).$instance);
          }
        }

      }
    );

    (<any>ProxyHTMLElement).observedAttributes = getObservedAttributes(cmpMeta);

    plt.defineComponent(cmpMeta.tag, ProxyHTMLElement);
  });

}