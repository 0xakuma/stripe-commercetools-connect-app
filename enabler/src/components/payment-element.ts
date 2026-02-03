import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod,
} from "../payment-enabler/payment-enabler";
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";
import { StripePaymentElement } from "@stripe/stripe-js";
import { apiService, ApiService } from "../services/api-service";
import { StripeService, stripeService } from "../services/stripe-service";
import { PaymentFlows } from "./payment-flows";
import { BaseComponent } from "./base";
import { paypalService, PayPalService, PayPalConfig } from "../services/paypal-service";

export class PaymentElementBuilder implements PaymentComponentBuilder {
  public componentHasSubmit = true;
  private baseOptions: BaseOptions;

  constructor(baseOptions: BaseOptions) {
    this.baseOptions = baseOptions;
  }

  build(_config: ComponentOptions): PaymentComponent {
    const component = new PaymentElementComponent(
      PaymentMethod.card,
      this.baseOptions,
      _config
    );
    return component;
  }
}

export class PaymentElementComponent extends BaseComponent {
  private paymentElement: StripePaymentElement;
  private api: ApiService;
  private stripe: StripeService;
  private paymentFlows: PaymentFlows;
  private paypalApi: PayPalService;
  private baseOptions: BaseOptions;
  private paypalMounted = false;
  private isPayPalSelected = false;
  private paypalConfig: PayPalConfig | null = null;

  constructor(
    paymentMethod: PaymentMethod,
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {
    super(paymentMethod, baseOptions, componentOptions);
    this.baseOptions = baseOptions;
    this.paymentElement = baseOptions.paymentElement as StripePaymentElement;
    this.api = apiService({
      baseApi: baseOptions.processorUrl,
      sessionId: baseOptions.sessionId,
    });
    this.stripe = stripeService({
      stripe: baseOptions.sdk,
      elements: baseOptions.elements,
    });
    this.paymentFlows = new PaymentFlows({
      api: this.api,
      stripe: this.stripe,
      elements: baseOptions.elements,
      paymentMode: baseOptions.paymentMode,
      onComplete: baseOptions.onComplete,
      onError: baseOptions.onError,
    });
    this.paypalApi = paypalService({
      baseApi: baseOptions.processorUrl,
      sessionId: baseOptions.sessionId,
    });
  }

  async mount(selector: string): Promise<void> {
    const container = document.querySelector(selector);
    if (!container) {
      console.error("Container not found:", selector);
      return;
    }

    // Clear container
    container.innerHTML = "";

    // Try to get PayPal config to determine if PayPal is available
    let paypalAvailable = false;
    try {
      this.paypalConfig = await this.paypalApi.getConfig();
      paypalAvailable = !!this.paypalConfig?.clientId;
    } catch (error) {
      console.log("PayPal not configured, showing only Stripe payment methods");
    }

    // Create wrapper for all payment methods
    const paymentMethodsWrapper = document.createElement("div");
    paymentMethodsWrapper.className = "payment-methods-wrapper";

    // Create container for Stripe Payment Element
    const stripeContainer = document.createElement("div");
    stripeContainer.id = "stripe-payment-element-container";
    paymentMethodsWrapper.appendChild(stripeContainer);

    // Add PayPal option if available
    if (paypalAvailable) {
      // Create PayPal option that looks like part of Stripe's list
      const paypalOption = document.createElement("div");
      paypalOption.id = "paypal-payment-option";
      paypalOption.className = "paypal-payment-option";
      paypalOption.style.cssText = `
        display: flex;
        align-items: center;
        padding: 16px 12px;
        cursor: pointer;
        border: 1px solid #e0e0e0;
        border-top: none;
        border-radius: 0 0 8px 8px;
        margin-top: -1px;
        background: #fff;
        transition: background-color 0.15s ease;
      `;

      paypalOption.innerHTML = `
        <div class="paypal-radio" style="
          width: 20px;
          height: 20px;
          border: 2px solid #ccc;
          border-radius: 50%;
          margin-right: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: border-color 0.15s ease;
        ">
          <div class="paypal-radio-inner" style="
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: transparent;
            transition: background-color 0.15s ease;
          "></div>
        </div>
        <span style="flex: 1; font-size: 14px; font-weight: 500; color: #30313d;">PayPal</span>
        <img src="https://www.paypalobjects.com/webstatic/mktg/Logo/pp-logo-100px.png"
             alt="PayPal"
             style="height: 20px; object-fit: contain;">
      `;

      // PayPal button container (hidden by default)
      const paypalButtonWrapper = document.createElement("div");
      paypalButtonWrapper.id = "paypal-button-wrapper";
      paypalButtonWrapper.style.cssText = `
        display: none;
        padding: 16px 12px;
        background: #f7f7f7;
        border: 1px solid #e0e0e0;
        border-top: none;
        border-radius: 0 0 8px 8px;
        margin-top: -1px;
      `;

      const paypalButtonContainer = document.createElement("div");
      paypalButtonContainer.id = "paypal-button-container";
      paypalButtonWrapper.appendChild(paypalButtonContainer);

      paymentMethodsWrapper.appendChild(paypalOption);
      paymentMethodsWrapper.appendChild(paypalButtonWrapper);

      // Handle PayPal option click
      paypalOption.addEventListener("click", () => {
        this.selectPayPal();
      });
    }

    container.appendChild(paymentMethodsWrapper);

    // Mount Stripe Payment Element
    this.paymentElement.mount("#stripe-payment-element-container");

    // Listen to Stripe Payment Element changes to deselect PayPal
    this.paymentElement.on("change", () => {
      if (this.isPayPalSelected) {
        this.deselectPayPal();
      }
    });

    // Also listen for clicks on the Stripe element container
    stripeContainer.addEventListener("click", () => {
      if (this.isPayPalSelected) {
        this.deselectPayPal();
      }
    });

    // Load PayPal SDK if available
    if (paypalAvailable && this.paypalConfig) {
      await this.initializePayPal();
    }

    // Add styles for Stripe element border radius adjustment
    this.addCustomStyles();
  }

  private addCustomStyles(): void {
    const styleId = "payment-element-custom-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .paypal-payment-option:hover {
        background-color: #f7f7f7 !important;
      }
      .paypal-payment-option.selected {
        background-color: #f7f7f7 !important;
      }
      .paypal-payment-option.selected .paypal-radio {
        border-color: #0570de !important;
      }
      .paypal-payment-option.selected .paypal-radio-inner {
        background-color: #0570de !important;
      }
      #stripe-payment-element-container .p-TabsItem:last-child,
      #stripe-payment-element-container iframe {
        border-radius: 8px 8px 0 0 !important;
      }
    `;
    document.head.appendChild(style);
  }

  private selectPayPal(): void {
    this.isPayPalSelected = true;

    const paypalOption = document.getElementById("paypal-payment-option");
    const paypalButtonWrapper = document.getElementById("paypal-button-wrapper");

    if (paypalOption) {
      paypalOption.classList.add("selected");
    }

    if (paypalButtonWrapper) {
      paypalButtonWrapper.style.display = "block";
    }

    // Collapse/blur the Stripe element to show PayPal is selected
    // We can't programmatically deselect Stripe, but we can visually indicate PayPal is active
    const stripeContainer = document.getElementById("stripe-payment-element-container");
    if (stripeContainer) {
      stripeContainer.style.opacity = "0.5";
      stripeContainer.style.pointerEvents = "none";
    }
  }

  private deselectPayPal(): void {
    this.isPayPalSelected = false;

    const paypalOption = document.getElementById("paypal-payment-option");
    const paypalButtonWrapper = document.getElementById("paypal-button-wrapper");

    if (paypalOption) {
      paypalOption.classList.remove("selected");
    }

    if (paypalButtonWrapper) {
      paypalButtonWrapper.style.display = "none";
    }

    // Restore Stripe element
    const stripeContainer = document.getElementById("stripe-payment-element-container");
    if (stripeContainer) {
      stripeContainer.style.opacity = "1";
      stripeContainer.style.pointerEvents = "auto";
    }
  }

  private async initializePayPal(): Promise<void> {
    if (this.paypalMounted || !this.paypalConfig) {
      return;
    }

    try {
      // Load PayPal SDK
      await this.paypalApi.loadPayPalSDK(
        this.paypalConfig.clientId,
        this.paypalConfig.currency,
        this.paypalConfig.environment
      );

      if (!window.paypal) {
        console.error("PayPal SDK not loaded");
        return;
      }

      await this.renderPayPalButton();
      this.paypalMounted = true;
    } catch (error) {
      console.error("Failed to initialize PayPal:", error);
    }
  }

  private async renderPayPalButton(): Promise<void> {
    if (!window.paypal || !this.paypalConfig) {
      return;
    }

    const config = this.paypalConfig;
    const onError = this.baseOptions.onError;

    await window.paypal.Buttons({
      fundingSource: window.paypal.FUNDING.PAYPAL,
      style: {
        layout: 'horizontal',
        color: 'blue',
        shape: 'rect',
        label: 'paypal',
        height: 44,
      },
      createOrder: async (_data, actions) => {
        try {
          const totalValue = (config.amount / 100).toFixed(2);

          if (parseFloat(totalValue) <= 0) {
            console.error("Cart total is zero or negative, cannot create PayPal order");
            throw new Error("Cart total must be greater than zero");
          }

          return await actions.order.create({
            intent: 'CAPTURE',
            purchase_units: [
              {
                reference_id: 'ORDER',
                description: 'Order Payment',
                amount: {
                  currency_code: config.currency,
                  value: totalValue,
                },
              },
            ],
          });
        } catch (error) {
          console.error("Error creating PayPal order:", error);
          onError(error);
          throw error;
        }
      },
      onApprove: async (data, actions) => {
        try {
          // Capture PayPal order client-side first
          const captureDetails = await actions.order.capture();
          console.log("PayPal order captured:", captureDetails);

          // Process payment server-side: create commercetools payment + order, then send completion event
          // This follows the same pattern as Stripe payment completion
          await this.paymentFlows.createPayPalPayment(data.orderID);
        } catch (error) {
          console.error("Error capturing PayPal order:", error);
          onError(error);
        }
      },
      onError: (err: Error) => {
        console.error("PayPal error:", err);
        onError(err);
      },
      onCancel: () => {
        console.log("PayPal payment cancelled by user");
      },
    }).render('#paypal-button-container');
  }

  async submit(): Promise<void> {
    if (this.isPayPalSelected) {
      // PayPal handles its own submission via the button
      console.log("PayPal payment - use the PayPal button to complete payment");
      return;
    }

    // Submit Stripe payment
    await this.paymentFlows.submit();
  }
}
