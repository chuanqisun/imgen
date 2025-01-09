import type { AzureConnectionProvider } from "../ai-bar";
import { attachShadowHtml } from "../wc-utils/attach-html";

export class AoaiConnectionButton extends HTMLElement implements AzureConnectionProvider {
  shadowRoot = attachShadowHtml(
    this,
    `
<style>
:host {
  .two-column {
    display: grid;
  }

  input + label {
    margin-top: 0.5rem;
  }

  button {
    font-size: 16px;
  }

  form {
    display: grid;
    gap: 1rem;
  }
}
</style>
<button title="Setup">⚙️</button>
<dialog style="width: min(40rem, calc(100vw - 32px))">
  <h2>Azure OpenAI Connection</h2>
  <form method="dialog" id="creds-form">
    <div class="two-column">
      <label for="aoai-endpoint">AOAI Endpoint</label>
      <input type="url" id="aoai-endpoint" name="aoai-endpoint"
        placeholder="https://replace-endpoint-name.openai.azure.com/" />

      <label for="aoai-key">AOAI Key</label>
      <input type="password" id="aoai-key" name="aoai-key" />

      <label for="openai-key">OpenAI Key</label>
      <input type="password" id="openai-key" name="openai-key" />

      <label for="speech-region">Azure Speech region</label>
      <input type="text" id="speech-region" name="speech-region" placeholder="eastus" />

      <label for="speech-key">Azure Speech key</label>
      <input type="password" id="speech-key" name="speech-key" />

      <label for="together-ai-key">TogetherAI key</label>
      <input type="password" id="together-ai-key" name="together-ai-key" />

      <!--
      <label for="eleven-labs-key">ElevenLabs key</label>
      <input type="password" id="eleven-labs-key" name="eleven-labs-key" />

      <label for="aoai-deployment-name">AOAI Deployment Name</label>
      <input type="text" id="aoai-deployment-name" name="aoai-deployment-name" placeholder="my-gpt-4o" />


      <label for="googleai-key">Google AI Key</label>
      <input type="password" id="googleai-key" name="googleai-key" />

      <label for="map-key">Azure Map Key</label>
      <input type="password" id="map-key" name="map-key" />

      <label for="aoai-endpoint-2">AOAI Endpoint 2</label>
      <input type="url" id="aoai-endpoint-2" name="aoai-endpoint-2"
        placeholder="https://replace-endpoint-name.openai.azure.com/" />

      <label for="aoai-key-2">AOAI Key 2</label>
      <input type="password" id="aoai-key-2" name="aoai-key-2" />
      -->
    </div>
    <button>Done</button>
  </form>
</dialog>
    `,
  );

  connectedCallback() {
    this.setAttribute("provides", "aoai-credentials, toolbar-item");
    this.shadowRoot.querySelector("button")?.addEventListener("click", () => {
      this.shadowRoot.querySelector("dialog")?.showModal();
    });

    const credsForm = this.shadowRoot.querySelector<HTMLFormElement>("#creds-form")!;

    credsForm.addEventListener("change", () => {
      const formData = new FormData(credsForm);
      const dataEntries = formData.entries();
      const dataDict = Object.fromEntries(dataEntries);
      localStorage.setItem("creds", JSON.stringify(dataDict));
      handleCredsChange(dataDict as Record<string, string>);
    });
    // immediately load creds from local storage at the start
    handleCredsChange(JSON.parse(localStorage.getItem("creds") ?? "{}"));

    async function handleCredsChange(creds: Record<string, string>) {
      Object.entries(creds).forEach(([key, value]) => {
        const field = credsForm.querySelector(`[name="${key}"]`) as HTMLInputElement;
        if (!field) return;
        field.value = value as string;
      });
    }
  }

  public getAzureConnection() {
    const aoaiEndpoint = this.shadowRoot.querySelector<HTMLInputElement>("#aoai-endpoint")?.value ?? "";
    const aoaiDeploymentName = this.shadowRoot.querySelector<HTMLInputElement>("#aoai-deployment-name")?.value ?? "";
    const aoaiKey = this.shadowRoot.querySelector<HTMLInputElement>("#aoai-key")?.value ?? "";
    const openaiKey = this.shadowRoot.querySelector<HTMLInputElement>("#openai-key")?.value ?? "";
    const togetherAIKey = this.shadowRoot.querySelector<HTMLInputElement>("#together-ai-key")?.value ?? "";
    const googleAIKey = this.shadowRoot.querySelector<HTMLInputElement>("#googleai-key")?.value ?? "";
    const mapKey = this.shadowRoot.querySelector<HTMLInputElement>("#map-key")?.value ?? "";
    const speechRegion = this.shadowRoot.querySelector<HTMLInputElement>("#speech-region")?.value ?? "";
    const speechKey = this.shadowRoot.querySelector<HTMLInputElement>("#speech-key")?.value ?? "";
    const elevenLabsKey = this.shadowRoot.querySelector<HTMLInputElement>("#eleven-labs-key")?.value ?? "";

    const aoaiEndpoint2 = this.shadowRoot.querySelector<HTMLInputElement>("#aoai-endpoint-2")?.value ?? "";
    const aoaiKey2 = this.shadowRoot.querySelector<HTMLInputElement>("#aoai-key-2")?.value ?? "";

    return {
      mapKey,
      aoaiEndpoint,
      aoaiDeploymentName,
      aoaiKey,
      googleAIKey,
      togetherAIKey,
      openaiKey,
      speechRegion,
      speechKey,
      elevenLabsKey,
      aoaiKey2,
      aoaiEndpoint2,
    };
  }
}

export function defineAzureConnection(tagName = "azure-connection") {
  customElements.define(tagName, AoaiConnectionButton);
}
