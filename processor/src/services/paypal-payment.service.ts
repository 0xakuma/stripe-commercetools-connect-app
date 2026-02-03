import { CommercetoolsCartService, CommercetoolsPaymentService } from '@commercetools/connect-payments-sdk';
import { getConfig } from '../config/config';
import { log } from '../libs/logger';
import { getCartIdFromContext, getPaymentInterfaceFromContext, getMerchantReturnUrlFromContext } from '../libs/fastify/context/context';
import { PayPalConfigResponseSchemaDTO, PayPalCaptureResponseSchemaDTO } from '../dtos/paypal-payment.dto';
import { PaymentTransactions } from '../dtos/operations/payment-intents.dto';
import { PaymentOutcome } from '../dtos/stripe-payment.dto';
import { SupportedPaymentComponentsSchemaDTO } from '../dtos/operations/payment-componets.dto';
import { createOrderFromCart } from './commerce-tools/order-client';

export interface PayPalPaymentServiceOptions {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
}

export class PayPalPaymentService {
  private ctCartService: CommercetoolsCartService;
  private ctPaymentService: CommercetoolsPaymentService;

  constructor(opts: PayPalPaymentServiceOptions) {
    this.ctCartService = opts.ctCartService;
    this.ctPaymentService = opts.ctPaymentService;
  }

  public async config(): Promise<PayPalConfigResponseSchemaDTO> {
    const config = getConfig();
    const cart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });

    return {
      clientId: config.paypalClientId,
      environment: config.paypalEnvironment,
      currency: amountPlanned.currencyCode,
      amount: amountPlanned.centAmount,
    };
  }

  public async getSupportedPaymentComponents(): Promise<SupportedPaymentComponentsSchemaDTO> {
    return {
      dropins: [],
      components: [{ type: 'paypal' }],
    };
  }

  /**
   * Record a PayPal payment that was captured client-side and create the order.
   * This creates the commercetools payment record and order.
   * The actual PayPal order capture happens client-side using PayPal SDK actions.
   */
  public async capturePayPalOrder(paypalOrderId: string): Promise<PayPalCaptureResponseSchemaDTO> {
    try {
      log.info('Starting PayPal order capture process', { paypalOrderId });

      // Get cart from context
      const cartId = getCartIdFromContext();
      if (!cartId) {
        log.error('Cart ID not found in context');
        throw new Error('Cart ID not found in context');
      }

      log.info('Retrieved cart ID from context', { cartId, paypalOrderId });

      const cart = await this.ctCartService.getCart({ id: cartId });
      if (!cart) {
        log.error('Cart not found in commercetools', { cartId, paypalOrderId });
        throw new Error(`Cart not found: ${cartId}`);
      }

      log.info('Retrieved cart from commercetools', { 
        cartId: cart.id, 
        cartVersion: cart.version,
        totalPrice: cart.totalPrice,
        paypalOrderId 
      });

      const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
      
      log.info('Calculated payment amount', { 
        amountPlanned, 
        cartId: cart.id, 
        paypalOrderId 
      });

      // Create commercetools payment with successful charge transaction
      // The PayPal order was already captured client-side via actions.order.capture()
      log.info('Creating commercetools payment', { 
        amountPlanned, 
        paypalOrderId,
        cartId: cart.id,
        customerId: cart.customerId,
        anonymousId: cart.anonymousId
      });

      const ctPayment = await this.ctPaymentService.createPayment({
        amountPlanned,
        interfaceId: paypalOrderId,
        paymentMethodInfo: {
          paymentInterface: getPaymentInterfaceFromContext() || 'paypal',
          method: 'paypal',
        },
        ...(cart.customerId
          ? { customer: { typeId: 'customer', id: cart.customerId } }
          : cart.anonymousId
            ? { anonymousId: cart.anonymousId }
            : null),
        transactions: [
          {
            type: PaymentTransactions.AUTHORIZATION,
            amount: amountPlanned,
            state: PaymentOutcome.AUTHORIZED,
            interactionId: paypalOrderId,
          },
          {
            type: PaymentTransactions.CHARGE,
            amount: amountPlanned,
            state: 'Success',
            interactionId: paypalOrderId,
          },
        ],
      });

      log.info('Successfully created commercetools payment', {
        ctPaymentId: ctPayment.id,
        paypalOrderId,
        cartId: cart.id,
      });

      // Add payment to cart
      log.info('Adding payment to cart', {
        cartId: cart.id,
        cartVersion: cart.version,
        ctPaymentId: ctPayment.id,
        paypalOrderId,
      });

      const updatedCart = await this.ctCartService.addPayment({
        resource: {
          id: cart.id,
          version: cart.version,
        },
        paymentId: ctPayment.id,
      });

      log.info('Successfully added payment to cart', {
        cartId: updatedCart.id,
        cartVersion: updatedCart.version,
        ctPaymentId: ctPayment.id,
        paypalOrderId,
      });

      log.info('PayPal payment recorded in commercetools', {
        ctCartId: cart.id,
        ctPaymentId: ctPayment.id,
        paypalOrderId: paypalOrderId,
      });

      // Create order from cart using the same pattern as Stripe
      // Uses: createOrderFromCart which calls apiClient.orders().post() with the exact pattern you specified
      log.info('Creating order from cart', {
        cartId: updatedCart.id,
        cartVersion: updatedCart.version,
        paypalOrderId,
      });

      const order = await createOrderFromCart(updatedCart);

      log.info('Order created successfully for PayPal payment using same pattern as Stripe', {
        ctOrderId: order.id,
        orderNumber: order.orderNumber,
        ctCartId: cart.id,
        paypalOrderId: paypalOrderId,
        orderState: order.orderState,
        paymentState: order.paymentState,
        shipmentState: order.shipmentState,
      });

      const response = {
        orderId: paypalOrderId,
        status: 'COMPLETED',
        paymentReference: ctPayment.id,
        ctOrderId: order.id,
        orderNumber: order.orderNumber,
        merchantReturnUrl: getMerchantReturnUrlFromContext() || getConfig().merchantReturnUrl,
      };

      log.info('PayPal capture process completed successfully', {
        response,
        paypalOrderId,
      });

      return response;
    } catch (error) {
      log.error('Error recording PayPal payment in commercetools', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        paypalOrderId,
        cartIdFromContext: getCartIdFromContext(),
      });
      throw error;
    }
  }
}
