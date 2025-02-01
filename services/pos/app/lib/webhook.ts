/**
 * Slackにメッセージを送信する
 * @param message 送信するメッセージ
 */
export const sendSlackMessage = async (message: string) => {
  const webhookUrl = import.meta.env.VITE_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error("WEBHOOK_URL is not defined");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    body: JSON.stringify({ text: message }),
  });

  if (!response.ok) {
    console.log(response);
    throw new Error("Failed to send message");
  }
};
