// Verified general meanings, reviewed 2026-09-14. Match only the exact originals.
// These are not guarantees about a restaurant's recipe or dietary safety.
// Never infer categories, prices, spice levels or allergens from this dictionary.
export const JAPANESE_MENU_GLOSSARY_B = [
  {
    originals: ['お好み焼き'],
    name: '일본식 양배추 부침개',
    description: '양배추와 반죽, 여러 재료를 철판에서 부친 음식',
    sources: ['https://www.japan.travel/en/gastronomy/local-cuisine-western-japan/'],
  },
  {
    originals: ['たこ焼き', 'タコ焼き'],
    name: '문어 반죽 볼',
    description: '문어를 넣은 반죽을 동그란 틀에서 구운 음식',
    sources: ['https://www.japan.travel/en/destinations/kansai/osaka/'],
  },
  {
    originals: ['もんじゃ焼き', 'もんじゃ'],
    name: '묽은 반죽 철판요리',
    description: '묽은 밀가루 반죽과 재료를 철판에서 익힌 음식',
    sources: ['https://www.maff.go.jp/j/syokuiku/kodomo_navi/cuisine/cuisine2_6.html'],
  },
  {
    // Outside a yakitori menu, negima can also refer to tuna and leek dishes.
    originals: ['ねぎま', 'ネギマ'],
    name: '대파를 넣은 네기마 요리',
    description: '꼬치 메뉴에서는 보통 닭고기와 대파를 끼운 음식',
    sources: [
      'https://www.japan.travel/en/guide/yakitori-a-guide-to-chicken-skewers/',
      'https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/search_menu/menu/34_26_tokyo.html',
    ],
  },
  {
    originals: ['つくね', 'ツクネ'],
    name: '다진 고기 완자',
    description: '고기를 다져 둥글거나 길쭉하게 뭉친 음식',
    sources: ['https://www.maff.go.jp/j/pr/aff/1612/spe2_01.html'],
  },
  {
    originals: ['ぼんじり', 'ボンジリ'],
    name: '닭 꼬리살',
    description: '닭 꼬리의 뿌리 부위 살을 사용하는 메뉴',
    sources: ['https://www.maff.go.jp/j/pr/aff/2009/spe1_02.html'],
  },
  {
    originals: ['せせり', 'セセリ'],
    name: '닭 목살',
    description: '닭의 목 부위 살을 사용하는 메뉴',
    sources: ['https://www.maff.go.jp/j/pr/aff/2009/spe1_02.html'],
  },
  {
    originals: ['手羽先'],
    name: '닭 날개 부위',
    description: '닭 날개의 끝 쪽 부위로, 조리법은 메뉴마다 달라요',
    sources: ['https://www.maff.go.jp/j/pr/aff/2009/pdf/aff2009_02_poster06.pdf'],
  },
  {
    originals: ['軟骨唐揚げ', '軟骨の唐揚げ'],
    name: '연골 튀김',
    description: '연골을 튀긴 음식으로, 사용하는 부위는 확인 필요',
    sources: ['https://www.nichireifoods.co.jp/assets/pdf/business/business_catalog2021SS_P05-12_chicken.pdf'],
  },
  {
    // 鶏南蛮 alone does not disambiguate chicken nanban from soba-style nanban.
    originals: ['鶏南蛮'],
    name: '닭고기 남반 요리',
    description: '튀김이나 국물 요리일 수 있어 조리법 확인 필요',
    sources: [
      'https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/search_menu/menu/chikin_nanban_miyazaki.html',
      'https://www.takarashuzo.co.jp/cooking/recipedata.php?id=1086',
    ],
  },
  {
    originals: ['蓮根はさみ揚げ', 'れんこんはさみ揚げ', '蓮根のはさみ揚げ'],
    name: '속을 넣은 연근튀김',
    description: '연근 사이에 속재료를 넣어 튀긴 음식',
    sources: ['https://www.maff.go.jp/j/seisan/ryutu/engei/IYFV2021/IYFV2021_menu/2_104.html'],
  },
  {
    originals: ['ししゃも焼き', 'シシャモ焼き'],
    name: '시샤모 생선구이',
    description: '시샤모라고 부르는 작은 생선을 구운 음식',
    sources: ['https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/search_menu/menu/shishamonokanroni_hokkaido.html'],
  },
  {
    // 開き means split open; it does not by itself prove drying or grilling.
    originals: ['ほっけ開き', 'ほっけの開き', 'ホッケ開き', 'ホッケの開き'],
    name: '펼친 호케 생선',
    description: '호케 생선을 갈라 펼친 것으로, 조리법은 확인 필요',
    sources: ['https://www.pref.hokkaido.lg.jp/sr/gid/fis035.html'],
  },
  {
    originals: ['茶碗蒸し'],
    name: '일본식 달걀찜',
    description: '달걀과 육수에 재료를 넣어 부드럽게 찐 음식',
    sources: ['https://www.maff.go.jp/j/yusyutu_kokusai/kokuchi/middle_east/japan-cuisine/ja/japan/19/index.html'],
  },
  {
    originals: ['筑前煮'],
    name: '닭고기 뿌리채소 조림',
    description: '닭고기와 뿌리채소 등을 볶은 뒤 국물에 졸인 음식',
    sources: ['https://www.maff.go.jp/j/seisan/kakou/mezamasi/recipe/recipe135.html'],
  },
  {
    originals: ['おでん盛り合わせ', 'おでん盛合せ'],
    name: '일본식 오뎅 모둠',
    description: '무와 어묵 등 여러 재료를 국물에 끓인 모둠요리',
    sources: ['https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/search_menu/menu/34_5_tokyo.html'],
  },
  {
    originals: ['きんぴらごぼう', '金平ごぼう'],
    name: '우엉 볶음조림',
    description: '가늘게 썬 우엉을 간장 양념으로 볶아 졸인 반찬',
    sources: ['https://www.maff.go.jp/j/seisan/kakou/mezamasi/recipe/recipe084.html'],
  },
  {
    originals: ['切り干し大根', '切干大根'],
    name: '말린 무채',
    description: '무를 가늘게 썰어 말린 재료로 만드는 반찬',
    sources: ['https://www.maff.go.jp/j/seisan/kakou/mezamasi/recipe/recipe079.html'],
  },
  {
    originals: ['ひじき煮', 'ひじきの煮物'],
    name: '톳 조림',
    description: '해조류인 톳을 양념 국물에 졸인 반찬',
    sources: [
      'https://www.maff.go.jp/j/seisan/kakou/mezamasi/recipe/recipe085.html',
      'https://www.maff.go.jp/j/keikaku/syokubunka/traditional-foods/menu/ise_hiziki.html',
    ],
  },
  {
    originals: ['白和え', '白あえ'],
    name: '으깬 두부 무침',
    description: '으깬 두부로 채소 등 재료를 버무린 음식',
    sources: ['https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/search_menu/menu/konnyaku_no_shiraae_kagawa.html'],
  },
  {
    originals: ['酢の物'],
    name: '식초 양념 무침',
    description: '여러 재료를 식초 양념으로 버무린 음식',
    sources: ['https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/search_menu/menu/sioika_no_sunomono_nagano.html'],
  },
  {
    originals: ['胡麻豆腐', 'ごま豆腐', '胡麻とうふ'],
    name: '참깨 묵',
    description: '참깨를 갈아 전분과 함께 익혀 굳힌 음식',
    sources: ['https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/search_menu/menu/goma_toufu_wakayama.html'],
  },
  {
    originals: ['湯葉刺し', '湯葉刺身', '湯葉の刺身'],
    name: '두유 막 생유바',
    description: '데운 두유 표면의 막을 건져 소스와 먹는 음식',
    sources: ['https://www.maff.go.jp/e/policies/market/k_ryouri/search_menu/6907/index.html'],
  },
  {
    originals: ['わらび餅', 'わらびもち'],
    name: '말랑한 전분 떡',
    description: '전분을 물과 함께 익혀 말랑하게 굳힌 일본식 떡',
    sources: ['https://www.maff.go.jp/j/keikaku/syokubunka/traditional-foods/menu/warabimoti.html'],
  },
  {
    originals: ['みたらし団子', 'みたらしだんご'],
    name: '달콤한 간장소스 경단',
    description: '쌀가루 경단에 달콤한 간장소스를 바른 간식',
    sources: ['https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/search_menu/menu/34_29_tokyo.html'],
  },
  {
    originals: ['あんみつ'],
    name: '한천·팥소 디저트',
    description: '한천에 팥소와 시럽을 곁들여 먹는 디저트',
    sources: ['https://www.gotokyo.org/book/wp-content/uploads/2020/10/2103_Muslim2021_JP.pdf'],
  },
  {
    originals: ['しめ鯖', 'しめさば', '〆鯖', '締め鯖'],
    name: '고등어 초절임',
    description: '고등어를 소금과 식초로 절인 음식',
    sources: ['https://www.maff.go.jp/j/keikaku/syokubunka/k_ryouri/search_menu/menu/sabanuta_fukui.html'],
  },
];
