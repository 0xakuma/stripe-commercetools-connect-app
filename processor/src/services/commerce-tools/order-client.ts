import { Cart, Order } from '@commercetools/platform-sdk';
import { paymentSDK } from '../../payment-sdk';

const apiClient = paymentSDK.ctAPI.client;

export const createOrderFromCart = async (cart: Cart) => {
  try {
    const latestCart = await paymentSDK.ctCartService.getCart({ id: cart.id });

    const res = await apiClient
      .orders()
      .post({
        body: {
          cart: {
            id: cart.id,
            typeId: 'cart',
          },
          shipmentState: 'Pending',
          orderState: 'Open',
          version: latestCart.version,
          paymentState: 'Paid',
        },
      })
      .execute();
    return res.body;
  } catch (error: any) {
    // Extract detailed error information from commercetools API
    const errorMessage = error?.body?.message || error?.message || 'Unknown error creating order';
    const errorDetails = error?.body?.errors || [];

    console.error('Failed to create order from cart:', {
      cartId: cart.id,
      errorMessage,
      errorDetails,
      statusCode: error?.statusCode || error?.code,
    });

    // Create a more detailed error message
    const detailedMessage = errorDetails.length > 0
      ? `${errorMessage}: ${errorDetails.map((e: any) => e.message || e.code).join(', ')}`
      : errorMessage;

    throw new Error(`Failed to create order from cart: ${detailedMessage}`);
  }
};

export const addOrderPayment = async (order: Order, paymentId: string) => {
  const response = await apiClient
    .orders()
    .withId({ ID: order.id })
    .post({
      body: {
        version: order.version,
        actions: [
          {
            action: 'addPayment',
            payment: {
              id: paymentId,
              typeId: 'payment',
            },
          },
        ],
      },
    })
    .execute();
  return response.body;
};
