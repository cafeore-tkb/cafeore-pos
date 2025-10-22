// import { converter, itemSchema, prodDB } from "@cafeore/common";
import type { MetaFunction } from "react-router";
import { DownloadButton } from "~/components/organisms/DownloadData";

export const meta: MetaFunction = () => {
  return [{ title: "Top / 珈琲・俺POS" }];
};

// export const clientLoader = async () => {
//   // clientLoader は Remix SPA 特有の関数で、ページロード時にクライアント側で実行される
//   // したがって現時点ではリアルタイムデータの取得はできない
//   // const itemsRef = collection(prodDB, "items").withConverter(
//   //   converter(itemSchema),
//   // );
//   // const docSnap = await getDocs(itemsRef);
//   // const items = docSnap.docs.map((doc) => doc.data());
//   // console.log(items);
//   // return { items };
// };

export default function Index() {
  // const { items } = useLoaderData<typeof clientLoader>();

  return (
    <div className="p-4 font-sans">
      <h1 className="font-bold font-noto text-3xl">珈琲・俺POS</h1>
      <ul className="mt-4 list-disc space-y-2 pl-6">
        <li>
          <a
            className="font-bold text-4xl text-amber-950"
            href="/cashier"
            rel="noreferrer"
          >
            レジ
          </a>
        </li>
        <li>
          <a
            className="font-bold text-4xl text-amber-950"
            href="/master"
            rel="noreferrer"
          >
            マスター
          </a>
        </li>
        <li>
          <a
            className="font-bold text-4xl text-amber-950"
            href="/serve"
            rel="noreferrer"
          >
            提供
          </a>
        </li>
        <li>
          <a
            className="font-bold text-4xl text-amber-950"
            href="/cashier-mini"
            rel="noreferrer"
          >
            レジ客用画面
          </a>
        </li>
        <li>
          <a
            className="font-bold text-4xl text-amber-950"
            href="/callscreen"
            rel="noreferrer"
          >
            呼び出し画面
          </a>
        </li>
        <li>
          <a
            className="font-bold text-4xl text-amber-950"
            href="/dashboard"
            rel="noreferrer"
          >
            ダッシュボード
          </a>
        </li>
      </ul>
      <h2 className="mt-5 font-bold font-noto text-3xl">
        オーダーデータ書き出し
      </h2>
      <DownloadButton />
      {/* <Button className="mt-4 bg-sky-900 text-white">Click me</Button>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="mt-4">
            <h2 className="text-xl">{item.name}</h2>
            <p>{item.price}</p>
            <p>{item.type}</p>
          </li>
        ))}
      </ul> */}
    </div>
  );
}
