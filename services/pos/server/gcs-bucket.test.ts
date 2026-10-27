import { describe, expect, test, vi } from "vitest";
import { type GcsBucket, gcsCallVoiceBucket } from "./gcs-bucket";

/** @google-cloud/storage の Bucket の代わり。file(name) ごとに download・save の偽物を返す */
const fakeBucket = (files: Record<string, Buffer> = {}) => {
  const download = vi.fn(async (name: string): Promise<[Buffer]> => {
    const data = files[name];
    if (!data) {
      // @google-cloud/storage の ApiError と同じく code に HTTP の状態が入る
      throw Object.assign(new Error("No such object"), { code: 404 });
    }
    return [data];
  });
  const save = vi.fn(
    async (_name: string, _data: Buffer, _options: unknown) => {},
  );
  const bucket: GcsBucket = {
    file: (name) => ({
      download: () => download(name),
      save: (data, options) => save(name, data, options),
    }),
  };
  return { bucket, download, save };
};

describe("[unit] 呼び出しの音声を溜める GCS", () => {
  test("あるものは中身を返す（大きな Buffer の一部でも、その分だけ）", async () => {
    // Buffer.from の小さなものは共有の領域の一部になるので、byteOffset が 0 とは限らない
    const pool = Buffer.from("....audio....");
    const audio = pool.subarray(4, 9);
    const { bucket, download } = fakeBucket({ "call-voice/a.mp3": audio });

    const object = await gcsCallVoiceBucket(bucket).get("call-voice/a.mp3");
    expect(object).not.toBeNull();
    const data = await object?.arrayBuffer();
    expect(new TextDecoder().decode(data)).toBe("audio");
    expect(download).toHaveBeenCalledWith("call-voice/a.mp3");
  });

  test("無いもの（404）は null、それ以外の失敗はそのまま投げる", async () => {
    const { bucket } = fakeBucket();
    await expect(
      gcsCallVoiceBucket(bucket).get("call-voice/none.mp3"),
    ).resolves.toBeNull();

    const failing: GcsBucket = {
      file: () => ({
        download: async () => {
          throw Object.assign(new Error("Forbidden"), { code: 403 });
        },
        save: async () => {},
      }),
    };
    await expect(
      gcsCallVoiceBucket(failing).get("call-voice/a.mp3"),
    ).rejects.toThrow("Forbidden");
  });

  test("溜めるときは型と、何の音声かのメタデータを付けて一度に送る", async () => {
    const { bucket, save } = fakeBucket();
    const audio = new TextEncoder().encode("audio").buffer;

    await gcsCallVoiceBucket(bucket).put("call-voice/a.mp3", audio, {
      httpMetadata: { contentType: "audio/mpeg" },
      customMetadata: {
        text: encodeURIComponent("提供口までお越しください。"),
      },
    });

    expect(save).toHaveBeenCalledTimes(1);
    const [name, data, options] = save.mock.calls[0];
    expect(name).toBe("call-voice/a.mp3");
    expect(data.toString()).toBe("audio");
    expect(options).toEqual({
      resumable: false,
      contentType: "audio/mpeg",
      metadata: {
        metadata: { text: encodeURIComponent("提供口までお越しください。") },
      },
    });
  });
});
