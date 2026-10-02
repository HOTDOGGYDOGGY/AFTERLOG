// 자료 구조 시험(netprobe.js): 응답의 모양만 남고 값(이름·글·주소 값·토큰)은 남지 않는다
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Api = {
  addResponse(store: unknown, info: Record<string, unknown>): { responses: number; order: string[]; endpoints: Record<string, Record<string, unknown>> };
  endpointOf(url: string, base?: string): { host: string; path: string; query: string[] };
  kindOf(v: unknown): string;
};
const load = (): Api => {
  const mod = { exports: {} as Api };
  new Function("module", readFileSync(resolve(process.cwd(), "collector/public/netprobe.js"), "utf8"))(mod);
  return mod.exports;
};

describe("자료 구조 시험", () => {
  const api = load();
  const comments = (n: number) =>
    JSON.stringify({
      result_code: 1,
      result_data: {
        items: Array.from({ length: n }, (_, i) => ({
          comment_id: 9000 + i,
          body: "비밀댓글내용<band:refer user_key=\"SECRETKEY\">비밀이름</band:refer>",
          author: { name: "비밀이름", member_key: "a1b2c3d4e5f6a1b2c3d4e5f6", profile_image_url: "https://coresos-phinf.pstatic.net/a/b.jpg?type=s75" },
          created_at: 1772000000000 + i,
          comment_count: 0,
        })),
        paging: { previous_params: { before: "123", content_key: "{\"post_no\":5}" }, next_params: null },
        total: 25,
      },
    });

  it("같은 주소 종류는 하나로 모으고 배열 길이·값 종류만 남긴다", () => {
    const store = { responses: 0, endpoints: {} as Record<string, Record<string, any>>, order: [] as string[] };
    const url = "https://api-kr.band.us/v2.3.0/get_comments?band_no=12345678&content_key=%7B%22post_no%22%3A5%7D&ts=1772000000000";
    api.addResponse(store, { via: "xhr", method: "GET", url, status: 200, ctype: "application/json", text: comments(20) });
    api.addResponse(store, { via: "xhr", method: "GET", url: url.replace("ts=1772000000000", "ts=1772000000999&after=55"), status: 200, ctype: "application/json", text: comments(5) });
    expect(store.order).toEqual(["GET api-kr.band.us/v2.3.0/get_comments"]);
    const e = store.endpoints[store.order[0]] as Record<string, any>;
    expect(e.count).toBe(2);
    expect(e.query).toEqual(["after", "band_no", "content_key", "ts"]);
    const items = e.shape.k.result_data.k.items;
    expect([items.min, items.max, items.sum]).toEqual([5, 20, 25]);
    expect(Object.keys(items.e.k.created_at.kinds)).toEqual(["num:epochMs"]);
    expect(Object.keys(items.e.k.author.k.profile_image_url.kinds)[0]).toBe("url:coresos-phinf.pstatic.net:img?type");
    expect(Object.keys(e.shape.k.result_data.k.total.kinds)).toEqual(["num:intS"]);
    const text = JSON.stringify(store);
    for (const secret of ["비밀댓글내용", "비밀이름", "SECRETKEY", "a1b2c3d4e5f6", "12345678", "1772000000000", "/a/b.jpg"]) expect(text).not.toContain(secret);
  });

  it("경로 속 숫자·식별자·한글은 가린다, JSON이 아니면 종류만", () => {
    expect(api.endpointOf("https://band.us/band/12345678/post/987654?keyword=비밀")).toEqual({ host: "band.us", path: "/band/:n/post/:n", query: ["keyword"] });
    expect(api.endpointOf("https://api-kr.band.us/v2.0.0/x/a1b2c3d4e5f6a1b2c3d4e5f6").path).toBe("/v2.0.0/x/:id");
    expect(api.endpointOf("https://my-secret-site.example/p").host).toBe("other");
    const store = { responses: 0, endpoints: {} as Record<string, Record<string, any>>, order: [] as string[] };
    api.addResponse(store, { method: "GET", url: "https://band.us/x", status: 200, ctype: "text/html", text: "<html>비밀</html>", via: "fetch" });
    const e = store.endpoints[store.order[0]] as Record<string, any>;
    expect(e.body).toEqual({ html: 1 });
    expect(e.shape).toBeNull();
    expect(JSON.stringify(store)).not.toContain("비밀");
  });
});
