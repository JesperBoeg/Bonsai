export type SpeciesKnowledgeEntry = {
  title: string;
  detail: string;
};

export type SpeciesSeasonCalendarEntry = {
  window: string;
  title: string;
  detail: string;
};

export type SpeciesCareProfile = {
  label: string;
  scientificName: string;
  careInstructions: SpeciesKnowledgeEntry[];
  characteristics: SpeciesKnowledgeEntry[];
  bonsaiSpecifics: SpeciesKnowledgeEntry[];
  seasonCalendar: SpeciesSeasonCalendarEntry[];
};

function knowledge(title: string, detail: string): SpeciesKnowledgeEntry {
  return { title, detail };
}

function season(window: string, title: string, detail: string): SpeciesSeasonCalendarEntry {
  return { window, title, detail };
}

const TEMPERATE_DECIDUOUS_CARE = [
  knowledge("Placement", "Grow outdoors in bright sun with moving air. Deciduous broadleaf bonsai generally want a real winter rest and stronger light than an indoor windowsill can provide."),
  knowledge("Watering", "Keep moisture even in active growth and never let the fine roots bake dry in a shallow pot. Good drainage still matters because soggy roots reduce vigor and ramification."),
  knowledge("Soil and feeding", "Use a free-draining bonsai mix and feed steadily from spring through early autumn. Push harder only when trunk or branch building matters more than short internodes."),
  knowledge("Winter protection", "Most deciduous species are hardy in the ground, but potted roots are not equally insulated. Protect shallow containers from severe freezing and repeated thaw-freeze cycles."),
];

const TEMPERATE_DECIDUOUS_CALENDAR = [
  season("Late winter", "Repot and structural work", "Repot before buds open and do heavier structural cuts while the silhouette is still clear. Spread major root work and major canopy reduction across seasons on weaker trees."),
  season("Spring", "Protect the first flush", "Watch swelling buds, guard against late frost, and start feed once growth is moving. Direct the first flush early so strong leaders do not steal all the energy."),
  season("Late spring to summer", "Refine with cutback", "Let shoots extend enough to gain strength, then cut back to preserve taper and ramification. Water hard in heat and thin dense canopies so light reaches the interior."),
  season("Autumn", "Reduce vigor and read the structure", "Ease off strong nitrogen, enjoy seasonal color, and study branch placement as leaves thin or drop. Light wiring and selective cleanup are often easier after extension slows."),
  season("Winter", "Dormancy and protection", "Keep the tree dormant, protect roots rather than forcing warmth, and use the quiet period to plan larger chops, grafts, or design edits for the coming cycle."),
];

const OUTDOOR_CONIFER_CARE = [
  knowledge("Outdoor placement", "Keep conifer bonsai outdoors year-round in sun and moving air. Indoor keeping weakens buds, reduces interior light, and usually starts a slow decline."),
  knowledge("Watering", "Water deeply, then let the mix move toward airy dampness rather than permanent saturation. Conifer roots prefer oxygen and suffer quickly in stale wet soil."),
  knowledge("Soil and feeding", "Use a sharp draining conifer mix and feed consistently through the growing season. Strong conifers hold interior foliage and respond to styling better than hungry trees."),
  knowledge("Winter protection", "Most outdoor conifers tolerate cold, but roots in bonsai pots still need shelter in severe freezes. Protect especially from dry wind, repeated freeze-thaw, and desiccation under winter sun."),
];

const OUTDOOR_CONIFER_CALENDAR = [
  season("Late winter", "Repot or set primary wire", "Repot only healthy trees at the right stage of swelling. Late winter is also a good time for structural wiring before the canopy gets dense again."),
  season("Spring", "Balance new growth", "Manage swelling buds and fresh extension early so strong outer tips do not starve interior growth. Species-specific techniques matter here more than generic pinching."),
  season("Summer", "Refine selectively", "Thin dense areas, shorten strong runners, and keep air in the pads. Summer is usually about selective control, not random shearing of the whole canopy."),
  season("Autumn", "Set the branch line", "As growth slows, refine branch selection, wire where needed, and check light access into the interior. Autumn work often sets the skeleton for the next season."),
  season("Winter", "Protect roots and foliage mass", "Conifers stay physiologically active in winter sunlight, so do not forget watering. Keep the rootball from freezing solid for extended periods."),
];

const TROPICAL_BROADLEAF_CARE = [
  knowledge("Light and warmth", "Give the brightest light you can provide and keep temperatures stable. Most tropical broadleaf bonsai improve dramatically when they can spend warm months outside."),
  knowledge("Watering", "Water thoroughly, then let the surface begin to dry before watering again. Constantly cold wet soil is more dangerous than a short, controlled dry interval."),
  knowledge("Feeding and humidity", "Feed during warm active growth and raise humidity when possible. Tropical species tolerate average indoor air differently, but none of them refine well in dark dry corners."),
  knowledge("Repotting", "Repot in warm weather when roots and shoots can start moving immediately. Warm recovery is one of the biggest advantages tropical species have in bonsai work."),
];

const TROPICAL_BROADLEAF_CALENDAR = [
  season("Late winter to early spring", "Increase light before growth surges", "As days lengthen, increase light and airflow before pushing fertilizer. Trees coming out of darker indoor conditions need acclimation, not shock."),
  season("Spring to summer", "Major growth and pruning window", "This is the main period for clip-and-grow, defoliation on strong trees, and repotting. Warmth, light, and feed let tropical species recover from work quickly."),
  season("Late summer", "Refine the silhouette", "Shorten extensions, thin crowded shoots, and choose sacrifice branches for the next cycle. Stop doing everything at once once light quality begins to drop."),
  season("Autumn", "Prepare for lower light", "Reduce heavy work, keep feeding only while growth is active, and move the tree before nights become cold. Sudden light loss often causes avoidable leaf drop."),
  season("Winter", "Maintain stability", "Keep tropical trees warm, bright, and away from drafts. Winter is for stability and health, not for big cuts unless the species is actively growing under excellent light."),
];

const MEDITERRANEAN_EVERGREEN_CARE = [
  knowledge("Sun and airflow", "Mediterranean species want strong sun, warm roots, and moving air. They are rarely at their best in shade or in warm indoor rooms with stale air."),
  knowledge("Watering", "Water deeply and allow a measured dry-down between waterings. They tolerate drought better than many species, but refinement still depends on consistent moisture during active growth."),
  knowledge("Soil and feeding", "Use a mineral, very free-draining mix and feed through the growing season. Too much organic retention and too little sun produce soft weak growth."),
  knowledge("Winter care", "Protect from stronger frost, especially when roots are exposed in shallow bonsai pots. Cool bright winter shelter is usually better than warm dim shelter."),
];

const MEDITERRANEAN_EVERGREEN_CALENDAR = [
  season("Late winter", "Review structure before the push", "Do repotting and heavier cuts as the tree wakes into warmth. Avoid combining severe root work with severe top reduction on weaker specimens."),
  season("Spring", "Build the branch framework", "Use the spring flush to choose leaders, shorten strong extensions, and guide budding where the design still needs density."),
  season("Summer", "Sun, water, and selective pruning", "Mediterranean bonsai can take heat when roots have water and oxygen. Summer pruning should preserve inner light and not just flatten the exterior."),
  season("Autumn", "Refine and harden", "As temperatures moderate, the tree often responds well to detail wiring and tighter selection work. Reduce fertilizer intensity as growth slows."),
  season("Winter", "Shelter roots, not vigor", "Keep trees cool and bright, protect from prolonged freezing, and do not force soft winter growth indoors if you can avoid it."),
];

const FLOWERING_FRUITING_CALENDAR = [
  season("Late winter", "Repot before flowers or fruit buds move", "Repot and structural edit before the bloom cycle commits. Once flower or fruit display is the goal, root work should become more conservative."),
  season("Spring", "Protect bloom and pollination", "Late frost, hard rain, and strong wind can ruin the show quickly. Decide early whether the year is for flowers and fruit or for branch building."),
  season("Late spring to summer", "Prune after the display", "Once flowering or fruit set has passed, cut back to re-establish shape and light. Heavy pruning at the wrong moment often removes the next season's short fruiting wood."),
  season("Autumn", "Choose between crop and refinement", "Remove excess fruit if it is weakening the tree and evaluate which shoots should become next year's short productive spurs."),
  season("Winter", "Dormancy and spur planning", "Use the leafless period to study spur placement, thorn structure, and taper. Fine fruiting bonsai are usually planned branch by branch, not merely clipped round."),
];

const PROFILE_LIBRARY = {
  "japanese-maple": {
    label: "Japanese maple",
    scientificName: "Acer palmatum",
    careInstructions: [
      knowledge("Light and placement", "Grow outdoors in bright air and protect from harsh afternoon sun when heat rises sharply. Thin leaves scorch quickly in hot dry wind."),
      knowledge("Watering", "Keep the rootball evenly moist in active growth and never let a refined tree dry hard. Drainage still needs to stay sharp so fine roots keep breathing."),
      knowledge("Soil and feeding", "Use a moisture-retentive but fast-draining deciduous mix and feed steadily through the growing season. Back off heavy nitrogen once you are chasing refinement rather than extension."),
      knowledge("Winter protection", "Japanese maple is hardy, but shallow roots need extra protection in severe cold. New spring buds and leaves are also vulnerable to late frost once they open."),
      knowledge("Repotting", "Repot just before bud break, usually every two to four years depending on age and vigor. Preserve radial roots rather than trying to solve all root problems in one repot."),
    ],
    characteristics: [
      knowledge("Seasonal color", "Spring foliage can emerge orange, yellow, or red depending on cultivar, then settle green before turning vivid autumn colors."),
      knowledge("Leaf and bark habit", "Leaves are opposite and finely lobed. Young bark is smooth and greenish to reddish before maturing toward light gray."),
      knowledge("Flowers and seed", "Small reddish flowers appear in late spring and are followed by paired winged samaras. Foliage display usually remains the main ornamental feature."),
    ],
    bonsaiSpecifics: [
      knowledge("Refinement strategy", "Use clip-and-grow for most branch refinement. Let shoots harden, then cut back to one or two nodes so ramification increases without losing taper."),
      knowledge("Back budding", "Healthy Japanese maples backbud on younger wood and on strong branches with light. They are less generous on old shaded interiors, so inner light is essential."),
      knowledge("Defoliation", "Partial or full defoliation can reduce leaf size and rebalance vigor, but only on strong established trees. Avoid stacking full defoliation with heavy root work or hard chops in the same year."),
      knowledge("Wiring caution", "Young green shoots wire easily, but older branches mark quickly. Guy wires and pruning often leave cleaner bark than prolonged wiring."),
      knowledge("Sacrifice use", "Maples thicken quickly with sacrifice branches, but swelling and inverse taper also appear quickly. Remove sacrifice growth before collars get heavy."),
    ],
    seasonCalendar: [
      season("Late winter", "Repot before buds crack", "Repot, graft, and correct the root base just before the buds open. This is also the safest window for heavier structural pruning on healthy trees."),
      season("Early spring", "Protect the first flush", "Guard swelling buds from late frost and keep watering even as the canopy starts to pull hard. Direct the first flush early to avoid long coarse internodes."),
      season("Late spring", "Cut back after hardening", "Once the new shoots harden, cut back to one or two nodes. This is also the window to judge whether any partial defoliation is justified on a strong tree."),
      season("Summer", "Prevent scorch and control vigor", "Give relief from brutal afternoon heat, water aggressively, and thin dense areas to keep inner buds alive. Weak or recently worked trees should simply grow and recover."),
      season("Autumn to winter", "Read the branch structure", "After leaves color and fall, study taper, spacing, and scars. Light wiring and next-year planning are usually better than more cutting at this stage."),
    ],
  },
  "trident-maple": {
    label: "Trident maple",
    scientificName: "Acer buergerianum",
    careInstructions: [
      knowledge("Light and heat", "Use full sun through most of the season and only protect from the hottest afternoon burn. Trident maple handles heat better than Japanese maple but still dislikes leaf scorch in shallow pots."),
      knowledge("Watering", "Water thoroughly and keep moisture steady through strong spring and summer growth. Let the mix breathe between waterings instead of keeping it heavy all day."),
      knowledge("Soil and feeding", "Use a mineral-rich fast-draining mix and feed generously when building trunks or primary branches. Refined trees can be fed more moderately once internode length matters more than mass."),
      knowledge("Winter protection", "Protect roots below about -5 C in a bonsai pot. The species is robust, but shallow containers remove a lot of natural insulation."),
    ],
    characteristics: [
      knowledge("Spring and autumn display", "Leaves can emerge with orange warmth, settle green, and finish with strong yellow to red autumn color."),
      knowledge("Bark and nebari potential", "Older bark can flake attractively and the species develops broad surface roots quickly when trained correctly."),
      knowledge("Growth strength", "Trident maple is notably vigorous, which is why it is such a good development species for trunk, taper, and nebari work."),
    ],
    bonsaiSpecifics: [
      knowledge("Clip-and-grow strength", "This is one of the best deciduous species for clip-and-grow. Let extensions run to build thickness, then cut back hard to reset taper and induce branching close to the trunk."),
      knowledge("Back budding and recovery", "Trident maple buds back readily and heals cuts quickly, which makes it forgiving when you need to rebuild earlier mistakes or execute major trunk chops."),
      knowledge("Defoliation", "Strong trees can take partial or full defoliation to reduce leaf size and balance vigor. Refining trees respond especially well when defoliation is selective rather than automatic."),
      knowledge("Nebari work", "Frequent early root correction pays off enormously with trident maple. Surface root quality is easiest to fix while the tree is still young and pushing hard."),
      knowledge("Wire discipline", "Young shoots set easily with wire, but they also thicken fast. Remove wire early or move to clip-and-grow and guying once the primary line is established."),
    ],
    seasonCalendar: [
      season("Late winter", "Repot and root-correct", "Repot before bud break and do the root work that keeps the nebari flat and radial. Tridents recover well when worked at the right moment."),
      season("Spring", "Build and select the first flush", "Let the first flush run where you need thickening and cut it back early where taper and compactness matter."),
      season("Early summer", "Refine branching", "Hardening shoots can be cut back repeatedly to build fine branch structure. Strong trees can also be partially defoliated to reset energy and leaf size."),
      season("Late summer", "Water hard and preserve inner growth", "Summer heat drives rapid growth and rapid drying. Keep the tree wet enough to stay strong, but thin the canopy so interior buds do not die."),
      season("Autumn to winter", "Study wounds and framework", "After leaf fall, evaluate scar closure, sacrifice branches, and taper. Clean planning now saves a lot of random pruning next year."),
    ],
  },
  "maple-family": {
    label: "Maple family",
    scientificName: "Acer species",
    careInstructions: TEMPERATE_DECIDUOUS_CARE,
    characteristics: [
      knowledge("Seasonal foliage", "Most maples are prized for spring freshness and autumn color rather than flowers or fruit. Many species reduce leaf size well once branch density improves."),
      knowledge("Sensitive foliage", "Maple leaves often show wind burn, drought stress, and afternoon scorch quickly, which makes them honest indicators of placement problems."),
      knowledge("Strong root and shoot response", "Healthy maples often push vigorously after pruning and root work, but the response varies by species and by how much light reaches the interior."),
    ],
    bonsaiSpecifics: [
      knowledge("Clip-and-grow first", "Maples generally refine best through repeated extension and cutback instead of constant wiring. Let a shoot do a job, then shorten it back to the design line."),
      knowledge("Back budding depends on light", "Even generous maple species lose interior budding if the canopy gets too dense. Thinning and light access are as important as fertilizer for inner ramification."),
      knowledge("Defoliation is not universal", "Leaf reduction techniques work on strong trees, but they should be species-sensitive and vigor-sensitive. Never treat a weak maple as if defoliation will fix it."),
      knowledge("Protect smooth bark", "Many maples mark easily. Use wire only as long as necessary and prefer pruning, guying, and directional cutback when clean bark matters."),
    ],
    seasonCalendar: TEMPERATE_DECIDUOUS_CALENDAR,
  },
  juniper: {
    label: "Juniper",
    scientificName: "Juniperus species",
    careInstructions: OUTDOOR_CONIFER_CARE,
    characteristics: [
      knowledge("Evergreen foliage behavior", "Depending on the species, foliage may be scale-like or needle-like. Winter bronzing or purpling is normal on many junipers."),
      knowledge("Light demand", "Junipers demand light inside the canopy. Once interior sprays are shaded out and die, they rarely refill deep bare wood on their own."),
      knowledge("Deadwood appeal", "The mix of live vein, bark, green foliage, and bleached deadwood is one of the classic visual strengths of juniper bonsai."),
    ],
    bonsaiSpecifics: [
      knowledge("Do not hedge-shear pads", "Avoid flattening every outer edge with scissors. Build pads by selective thinning and directional pruning so light reaches the inside and the foliage stays alive from within."),
      knowledge("Back budding limits", "Junipers do not reliably backbud on old bare wood. Always leave live green growth wherever future branching may be needed."),
      knowledge("Juvenile foliage", "Heavy stress, hard bending, and bad watering can push scale junipers back into juvenile needle foliage. Recovery comes from stable health, not from more stress."),
      knowledge("Deadwood work", "Junipers are excellent for jin and shari, but deadwood must respect the live vein. Great deadwood on a juniper is a vascular decision, not only a carving decision."),
      knowledge("Wiring and raffia", "Young juniper can take dramatic movement. Older bends often need raffia or protection and must be checked often for bite-in as the tree swells."),
    ],
    seasonCalendar: [
      season("Late winter", "Repot only healthy trees", "Repot conservatively as the tree wakes and keep enough foliage to power recovery. Structural wire can also be set clearly before the season clutters the pads."),
      season("Spring", "Select and thin new extension", "Use the first flush to decide which runners stay, which are shortened, and where light needs to be opened into the pads."),
      season("Summer", "Preserve interior light", "Summer work should focus on thinning congestion and preventing exterior domination. Random all-over pinching often weakens the interior instead of helping it."),
      season("Autumn", "Wire the branch line", "With growth slowing, autumn is excellent for branch setting, deadwood review, and structural clarity. Set the skeleton now so spring growth fills the right spaces."),
      season("Winter", "Water through cold sun", "Do not forget watering just because the tree is dormant. Evergreens still desiccate in cold wind and bright winter light."),
    ],
  },
  pine: {
    label: "Pine family",
    scientificName: "Pinus species",
    careInstructions: OUTDOOR_CONIFER_CARE,
    characteristics: [
      knowledge("Species-specific flush behavior", "Some pines are two-flush species and some are single-flush. That difference changes almost every high-value bonsai technique, especially candle work."),
      knowledge("Needle and bud rhythm", "Bud placement, needle length, and energy balance all tell you how strong each branch is. Pines communicate vigor more clearly than many broadleaf trees."),
      knowledge("Bark and age", "Pines often gain visual age through bark, plate texture, and trunk movement earlier than through fine twigging."),
    ],
    bonsaiSpecifics: [
      knowledge("Know your flush type", "Do not blindly apply black pine decandling to every pine. Japanese black and red pines can be worked as two-flush species, while white pine and many others cannot."),
      knowledge("Old wood budding limits", "Pines are not trident maples. Preserve buds and needles where future structure is needed because completely bare sections often stay bare."),
      knowledge("Needle and energy balancing", "Needle plucking, candle selection, and bud selection are energy-balancing tools, not cosmetic chores. Good pine refinement comes from equalizing branch strength branch by branch."),
      knowledge("Wire for age and line", "Primary pine design often depends on strong wire work. Set movement while branches are still workable and refine with repeated rewiring rather than heroic one-time force."),
      knowledge("Sacrifice branches", "Pines thicken well through sacrifice branches, but swelling and reverse taper can become permanent. Sacrifice growth must be used aggressively and removed on time."),
    ],
    seasonCalendar: [
      season("Late winter", "Repot and set structure", "Repot healthy trees at the appropriate swelling stage and wire primary branches while the canopy is readable. Avoid combining severe root work with severe candle reduction."),
      season("Spring", "Manage buds and candles", "Select buds, thin clusters, and watch candle strength carefully. Early decisions here determine whether the tree strengthens evenly or only at the tips."),
      season("Early summer", "Use species-specific candle work", "Two-flush pines may be decandled for refinement in this window, but single-flush pines must be managed very differently. Always work by species and by strength, not by habit."),
      season("Late summer to autumn", "Balance needles and wire", "Needle plucking, bud balancing, and autumn wiring are key refinement tools. The goal is equal energy, interior light, and clear pad structure."),
      season("Winter", "Protect roots and study buds", "Winter lets you read the branch line and next year's buds clearly. Protect the rootball but keep the tree cold enough to hold proper dormancy."),
    ],
  },
  "cool-climate-conifer": {
    label: "Spruce, fir, and hemlock group",
    scientificName: "Picea, Abies, and Tsuga species",
    careInstructions: OUTDOOR_CONIFER_CARE,
    characteristics: [
      knowledge("Dense cool-climate foliage", "These conifers prefer cooler roots and usually finer, denser growth than many pines when they are healthy and well lit."),
      knowledge("Interior shade sensitivity", "They weaken from the inside if dense outer growth blocks light. Interior life depends on routine thinning, not on hope."),
      knowledge("Species nuance", "Fir, spruce, and hemlock differ in bud behavior and flexibility, but they broadly reward measured refinement rather than violent reduction."),
    ],
    bonsaiSpecifics: [
      knowledge("Preserve inner buds", "Do not strip to bare wood and expect it to refill. These conifers need active buds or short shoots maintained close to the trunk and branch interior."),
      knowledge("Refine by shortening, not shaving", "Pinch or shorten fresh growth selectively instead of buzz-cutting the whole surface. Refinement comes from bud management and thinning, not hedge shearing."),
      knowledge("Wire with restraint", "Young branches set well, but old wood can be stiff or brittle depending on species. Build line through repeated lighter corrections rather than single extreme bends."),
      knowledge("Cool-root discipline", "Hot dry roots weaken these species quickly. Summer watering and pot protection can matter as much as pruning if you want inner life and dense budding."),
    ],
    seasonCalendar: OUTDOOR_CONIFER_CALENDAR,
  },
  "cedar-cypress-conifer": {
    label: "Cedar and cypress family conifers",
    scientificName: "Cedrus, Cupressaceae, and related conifers",
    careInstructions: OUTDOOR_CONIFER_CARE,
    characteristics: [
      knowledge("Pad-forming evergreen habit", "Many of these species carry scale or soft awl foliage that lends itself to layered pads and textured masses rather than needle bundles."),
      knowledge("Sun and airflow dependence", "They stay healthiest and densest in bright, airy positions. Stale crowded foliage quickly becomes weak or coarse."),
      knowledge("Species range", "This group includes cedar, cypress, false cypress, arborvitae, and related conifers that share many broad bonsai principles even when detail techniques differ."),
    ],
    bonsaiSpecifics: [
      knowledge("Thin for light penetration", "Scale-foliage conifers often need internal thinning so the pad does not become a hollow shell. Preserve live foliage close to the branch line at all times."),
      knowledge("Do not remove all green interior", "Once the inner shoots die, replacement is slow or impossible. Every styling decision should protect the interior as well as the outer silhouette."),
      knowledge("Use wire before wood stiffens", "Many cypress-family branches are easiest to shape while young. Older branches can become rigid and may split if forced too late."),
      knowledge("Watch juvenile reversion", "Some species revert to coarser juvenile growth after heavy stress or repeated bad pruning. Good health and measured work usually restore finer foliage sooner."),
    ],
    seasonCalendar: OUTDOOR_CONIFER_CALENDAR,
  },
  "deciduous-conifer": {
    label: "Deciduous conifer group",
    scientificName: "Larix, Taxodium, Metasequoia, and related species",
    careInstructions: [
      knowledge("Placement", "Grow outdoors in full sun with strong airflow. These species love light and most of them enjoy more water than evergreen conifers do."),
      knowledge("Watering", "Keep moisture generous during active growth. Bald cypress and dawn redwood especially dislike drying hard in hot weather."),
      knowledge("Soil and feeding", "Use a draining mix but do not be afraid of water retention that suits the species. Feed from spring through summer so the trees can support strong extension and back budding."),
      knowledge("Winter protection", "They are hardy in the ground but shallow roots still need protection from severe freezes. Winter dormancy is part of their strength, not something to avoid."),
    ],
    characteristics: [
      knowledge("Needles that drop", "These conifers carry soft seasonal foliage that yellows or bronzes before dropping in autumn. The winter silhouette becomes fully visible after leaf fall."),
      knowledge("Fast extension", "Many deciduous conifers extend strongly and can become coarse quickly if pruning lags behind the season."),
      knowledge("Distinct habitat cues", "Some species love swampy moisture, some cooler uplands, but all reward strong light and clear seasonal rhythm."),
    ],
    bonsaiSpecifics: [
      knowledge("Cut back after hardening", "Let fresh shoots extend enough to gain strength, then prune back after they begin to harden. Constant early pinching often reduces vigor without improving structure."),
      knowledge("Back budding is valuable", "These species can reward strong health with useful back budding, which is why they are so forgiving in development compared with many evergreens."),
      knowledge("Use the winter silhouette", "Winter is when branch order, taper, and structural weakness are easiest to read. Design corrections should often be planned from the leafless season."),
      knowledge("Water according to the species", "Do not bonsai all deciduous conifers the same way. Bald cypress tolerates and likes much wetter conditions than larch, for example."),
    ],
    seasonCalendar: [
      season("Late winter", "Repot before bud push", "Repot as buds swell and complete heavier branch edits while the structure is exposed."),
      season("Spring", "Watch the soft flush", "New growth appears quickly and can become coarse fast. Decide early which extensions are building structure and which are already too strong."),
      season("Summer", "Cut back and water heavily", "Summer is the main refinement window, but it is also the main dehydration risk window. Keep the rootball cool and wet enough for the species."),
      season("Autumn", "Enjoy color and prepare dormancy", "As needles color and drop, review the full structure and taper. Reduce strong feeding and prepare winter protection."),
      season("Winter", "Study the framework", "Winter is ideal for design assessment, wire review, and planning the next structural season."),
    ],
  },
  "yew-family": {
    label: "Yew family",
    scientificName: "Taxus and Cephalotaxus species",
    careInstructions: OUTDOOR_CONIFER_CARE,
    characteristics: [
      knowledge("Shade tolerance", "Yews handle less intense light than many conifers, but bonsai refinement still improves with good sun and airflow."),
      knowledge("Dark dense foliage", "Needle masses can become very dark and compact, which suits old powerful bonsai if interior light is protected."),
      knowledge("Strong longevity", "Yew wood and bark age beautifully, which is why older specimens can look ancient even before fine ramification is complete."),
    ],
    bonsaiSpecifics: [
      knowledge("Back budding strength", "Yews are unusually generous about back budding on older wood for a conifer, which makes major redesign and recovery more realistic than on pine or juniper."),
      knowledge("Deadwood contrast", "Deadwood can work well, but the species is often strongest as an ancient dark evergreen mass with strong trunk character rather than a bleached-deadwood drama tree."),
      knowledge("Clip and wire together", "Yew responds well to both pruning and wire. Use pruning to shorten and densify, then wire to open space where dense foliage masses would otherwise merge."),
      knowledge("Toxicity caution", "All parts are toxic. That matters less to the tree than to the handler, but it is worth remembering during pruning and cleanup."),
    ],
    seasonCalendar: OUTDOOR_CONIFER_CALENDAR,
  },
  "redwood-family": {
    label: "Redwood family",
    scientificName: "Sequoia and Sequoiadendron species",
    careInstructions: [
      knowledge("Placement", "Give full sun in cool climates and some relief in brutal drying heat. Redwoods want strong light but dislike root desiccation."),
      knowledge("Watering", "Keep them evenly moist. These species look tougher than they are when roots are allowed to dry repeatedly in a shallow pot."),
      knowledge("Soil and feed", "Use a free-draining mix that still holds moisture and feed through the growing season. Healthy redwoods extend strongly and need nutrition to support controlled refinement."),
      knowledge("Winter care", "Protect roots from extreme freeze and drying wind. The top can take cold, but a bonsai pot removes much of the safety margin."),
    ],
    characteristics: [
      knowledge("Strong vertical habit", "Redwoods tend toward upright lines and clear apical drive. Their natural architecture favors tall, powerful silhouettes rather than low broad cushions."),
      knowledge("Soft fibrous foliage", "Foliage texture is softer than pine and reads best when pads are open and layered instead of packed into tight balls."),
      knowledge("Fast juvenile extension", "Young growth can be vigorous and coarse, which is useful in development but needs discipline in refinement."),
    ],
    bonsaiSpecifics: [
      knowledge("Build taper with controlled sacrifice", "Redwoods respond well to sacrifice growth when building trunks and leaders, but the apical region can thicken too quickly if unchecked."),
      knowledge("Refine by repeated cutback", "Let extensions strengthen a branch, then shorten them back to preserve taper and encourage side growth. Constant superficial trimming is less effective than real directional pruning."),
      knowledge("Protect moisture at the roots", "Redwood bonsai work goes badly when the roots overheat or dry. Pot insulation and reliable summer watering are as important as pruning technique."),
      knowledge("Wire for line, not contortion", "Young shoots wire well, but most convincing redwood bonsai still rely on natural upright movement more than on extreme twists."),
    ],
    seasonCalendar: OUTDOOR_CONIFER_CALENDAR,
  },
  "chinese-elm": {
    label: "Chinese elm",
    scientificName: "Ulmus parvifolia",
    careInstructions: [
      knowledge("Placement", "Chinese elm is happiest outdoors in full sun or light partial shade. Depending on origin, it may tolerate some frost or want a protected cool winter."),
      knowledge("Watering", "Water thoroughly when the mix begins to dry and avoid keeping the rootball permanently heavy. Strong elms are forgiving, but soggy roots still weaken them."),
      knowledge("Soil and feeding", "Use a draining mix and feed through the growing season. Elm responds quickly to fertilizer, so refinement requires pruning discipline as much as good nutrition."),
      knowledge("Repotting", "Repot in late winter or early spring. The species handles routine root work well when healthy."),
    ],
    characteristics: [
      knowledge("Small glossy leaves", "Chinese elm naturally carries small glossy foliage and develops beautiful mottled bark as it matures."),
      knowledge("Variable leaf drop", "Depending on provenance and climate it can be deciduous, semi-evergreen, or nearly evergreen."),
      knowledge("Ramification potential", "It is one of the easiest deciduous species for fine twigging and dense compact canopies."),
    ],
    bonsaiSpecifics: [
      knowledge("Back budding", "Chinese elm backbuds readily on healthy wood, which makes redesign and correction forgiving compared with many species."),
      knowledge("Refinement by repeated cutback", "Let a shoot run, then cut it back to one or two leaves again and again through the growing season. That is how the dense twig mesh is built."),
      knowledge("Defoliation", "Partial or full defoliation is a valid refinement tool on strong trees and usually gives smaller leaves and tighter internodes. It is not a treatment for weakness."),
      knowledge("Broom-style strength", "Chinese elm excels in broom and upright silhouettes because it naturally builds a very fine crown once the primary branch order is right."),
    ],
    seasonCalendar: TEMPERATE_DECIDUOUS_CALENDAR,
  },
  "elm-family": {
    label: "Elm family",
    scientificName: "Ulmus species",
    careInstructions: TEMPERATE_DECIDUOUS_CARE,
    characteristics: [
      knowledge("Strong deciduous growth", "Most elm species are vigorous and respond well to pruning, though hardiness, bark, and leaf texture vary by species."),
      knowledge("Fine ramification potential", "Elm is valued in bonsai because it can quickly build dense twigging when strong and repeatedly pruned."),
      knowledge("Broad styling range", "Although some elm species read beautifully in broom form, they can also work well in upright, informal, or naturalistic deciduous shapes."),
    ],
    bonsaiSpecifics: [
      knowledge("Exploit back budding", "Healthy elms often bud well after cutback, which lets you move branch lines inward over time instead of accepting endless coarse extensions."),
      knowledge("Repeated clip-and-grow", "Elm refinement is mostly a cycle of extension and hard cutback. Leaving growth unchecked for too long quickly coarsens internodes and silhouette."),
      knowledge("Defoliate selectively", "Where vigor is strong, partial defoliation and leaf pruning can help reduce leaf size and reset branch balance. Use the method because the tree is strong, not to make it strong."),
      knowledge("Wire lightly", "Young shoots wire easily but mark fast. Most elm line work is best finalized with pruning rather than prolonged heavy wire."),
    ],
    seasonCalendar: TEMPERATE_DECIDUOUS_CALENDAR,
  },
  "japanese-zelkova": {
    label: "Japanese zelkova",
    scientificName: "Zelkova species",
    careInstructions: TEMPERATE_DECIDUOUS_CARE,
    characteristics: [
      knowledge("Classic broom silhouette", "Zelkova is one of the defining broom-style bonsai species, with a strong trunk that fans into fine upper ramification."),
      knowledge("Leaf size in containers", "Leaf size reduces readily in pot culture, which is part of why the species works so well for refined deciduous bonsai."),
      knowledge("Autumn interest", "Leaves carry strong yellow, orange, red, and even purple tones in autumn, while the smooth gray bark keeps the winter silhouette clean."),
    ],
    bonsaiSpecifics: [
      knowledge("Clip-and-grow for branch order", "Build the canopy by extension and hard cutback, preserving the radial broom pattern and avoiding bar branches, crossings, or heavy parallel lines."),
      knowledge("Protect inner buds", "Even vigorous zelkova loses interior density if outer growth stays too dense. Light management is a refinement technique, not just a horticultural courtesy."),
      knowledge("Defoliation on strong trees", "Strong trees can be partially or fully defoliated to improve leaf size and twig density, but only after a season of real vigor."),
      knowledge("Read the crown structurally", "Because broom-style branch order is so exposed, structural mistakes show immediately. Correcting them early is far easier than trying to hide them later."),
    ],
    seasonCalendar: TEMPERATE_DECIDUOUS_CALENDAR,
  },
  "hornbeam-beech": {
    label: "Hornbeam and beech group",
    scientificName: "Carpinus, Fagus, and Ostrya species",
    careInstructions: TEMPERATE_DECIDUOUS_CARE,
    characteristics: [
      knowledge("Fine deciduous silhouette", "These species are prized for elegant deciduous structure, smooth or gently textured bark, and refined twigging rather than aggressive floral display."),
      knowledge("Sensitive leaves", "Many hornbeams and beeches show drought, heat, and late frost stress quickly in shallow pots."),
      knowledge("Seasonal beauty", "Fresh spring leaves, calm green summer canopies, and strong autumn color make them rewarding year-round deciduous bonsai."),
    ],
    bonsaiSpecifics: [
      knowledge("Clip-and-grow with patience", "These trees refine well through repeated cutback, but they are usually a little more measured than elm or trident maple. Patience gives cleaner branch order."),
      knowledge("Smooth bark discipline", "Smooth-barked deciduous bonsai show wire scars and swelling immediately, so guy wires and pruning often age better than aggressive wiring."),
      knowledge("Maintain inner light", "If the outer shell gets too dense, inner buds weaken and branch options disappear. Thin for light even when the silhouette already looks full enough from the front."),
      knowledge("Respect species vigor", "Korean hornbeam, European beech, and related species do not all respond identically. Work to the vigor of the specific tree, not the reputation of the group."),
    ],
    seasonCalendar: TEMPERATE_DECIDUOUS_CALENDAR,
  },
  hackberry: {
    label: "Hackberry group",
    scientificName: "Celtis species",
    careInstructions: TEMPERATE_DECIDUOUS_CARE,
    characteristics: [
      knowledge("Tough deciduous growth", "Hackberry species are rugged, sun-loving deciduous trees that often carry interesting bark and strong drought tolerance once established."),
      knowledge("Naturalistic character", "They suit naturalistic and informal deciduous styles especially well because the branching often feels loose and believable rather than manicured."),
      knowledge("Small-leaf potential", "In bonsai culture the leaves usually reduce well enough to support medium and even smaller-scale work when the canopy is refined."),
    ],
    bonsaiSpecifics: [
      knowledge("Use vigorous cutback", "Hackberry responds well to extension and reduction cycles. Let branches gain thickness, then cut back hard to bring movement and taper inward."),
      knowledge("Back budding with strength", "Healthy trees can bud back usefully after pruning, which makes structure correction realistic without constant grafting or compromise."),
      knowledge("Develop branch rhythm", "Because the species can look coarse if left unchecked, branch selection and negative space matter as much as raw ramification."),
      knowledge("Wire young wood only", "Young shoots bend easily, but older wood can become stiff and uncooperative. Do movement work early and let pruning handle later refinement."),
    ],
    seasonCalendar: TEMPERATE_DECIDUOUS_CALENDAR,
  },
  ficus: {
    label: "Tropical ficus",
    scientificName: "Ficus species",
    careInstructions: TROPICAL_BROADLEAF_CARE,
    characteristics: [
      knowledge("Evergreen tropical habit", "Ficus keeps leaves year-round, bleeds white latex when cut, and can produce aerial roots in very humid conditions."),
      knowledge("Variable bark and leaf size", "Different ficus used in bonsai vary in leaf size, bark texture, and aerial-root tendency, but their broad warm-climate care is similar."),
      knowledge("Stress response", "Sudden leaf drop often follows abrupt light change, cold drafts, or overwatering, but strong ficus usually refoliates once conditions stabilize."),
    ],
    bonsaiSpecifics: [
      knowledge("Back budding and trunk chops", "Ficus backbuds strongly and handles trunk chops well when warm and bright. That makes it one of the best species for rebuilding primary structure."),
      knowledge("Leaf reduction", "Defoliation and repeated leaf pruning can reduce leaf size and increase ramification, but only if heat and light are strong enough to support a quick second flush."),
      knowledge("Aerial roots", "Aerial roots are a design project, not a random bonus. Raise humidity dramatically, guide roots downward, and do not let them dry once they start forming."),
      knowledge("Wire early", "Young shoots wire easily, but older ficus branches lignify and can snap unexpectedly. Soft bark also marks, so check wire more often than you think."),
    ],
    seasonCalendar: TROPICAL_BROADLEAF_CALENDAR,
  },
  "tropical-broadleaf-indoor": {
    label: "Tropical broadleaf bonsai",
    scientificName: "Warm-climate evergreen broadleaf species",
    careInstructions: TROPICAL_BROADLEAF_CARE,
    characteristics: [
      knowledge("Warm-climate habit", "These species keep foliage year-round and rely more on warmth and light than on winter dormancy."),
      knowledge("Indoor compromise", "They can survive indoors better than temperate trees, but refinement still depends on much stronger light than many homes naturally provide."),
      knowledge("Frequent pruning response", "Most of these broadleaf tropical species respond well to repeated shoot pruning and can be kept compact when grown strongly."),
    ],
    bonsaiSpecifics: [
      knowledge("Refine in warm active growth", "Do your real branch-building and repotting when the tree is truly moving. Weak winter light is maintenance time, not ambitious styling time."),
      knowledge("Balance humidity and airflow", "High humidity helps leaf quality, but stagnant humid air invites pests. Tropical bonsai still wants airflow and drying between waterings."),
      knowledge("Clip-and-grow dominates", "Most warm broadleaf species refine better through repeated directional pruning than through heavy permanent wiring."),
      knowledge("Species vary, health rules", "Some species drop leaves easily after stress, some are tougher, but all of them punish cold wet roots and dark corners."),
    ],
    seasonCalendar: TROPICAL_BROADLEAF_CALENDAR,
  },
  "tropical-flowering-tree": {
    label: "Tropical flowering tree group",
    scientificName: "Warm-climate flowering broadleaf species",
    careInstructions: TROPICAL_BROADLEAF_CARE,
    characteristics: [
      knowledge("Flower display", "These species are grown partly for flowers, which means timing and sunlight often matter more than in purely foliage-driven bonsai."),
      knowledge("Heat dependence", "Bloom quality usually improves with stronger sun and warmer nights. Weak light produces growth without the floral payoff."),
      knowledge("Fast seasonal response", "Many tropical flowering trees can shift quickly from vegetative growth to flowering and back again when warmth and pruning timing line up."),
    ],
    bonsaiSpecifics: [
      knowledge("Prune after bloom, not before", "If flowering matters, major cutting is usually safest after the display rather than just before it. The wrong pruning window trades flowers for convenience."),
      knowledge("Allow some extension", "Trees grown only as tight green domes rarely flower well. Controlled extension is often part of setting buds and preparing a proper display."),
      knowledge("Branch brittleness varies", "Many warm flowering species carry brittle or fast-scarred wood, so guy wires and pruning often age better than heavy direct bending."),
      knowledge("Pick the goal for the year", "A season can be mainly for branch building or mainly for flowers, but rarely both at maximum intensity. Good bonsai culture chooses deliberately instead of hoping for both."),
    ],
    seasonCalendar: TROPICAL_BROADLEAF_CALENDAR,
  },
  "temperate-deciduous-broadleaf": {
    label: "Temperate deciduous broadleaf group",
    scientificName: "Mixed deciduous tree and shrub species",
    careInstructions: TEMPERATE_DECIDUOUS_CARE,
    characteristics: [
      knowledge("Seasonal rhythm", "These species are strongest when they live through a full deciduous cycle with winter rest, spring push, summer hardening, and autumn shutdown."),
      knowledge("Branch and bark diversity", "The group includes everything from smooth-barked refinement trees to rough-barked rugged species, but the broad horticultural rhythm is similar."),
      knowledge("Design flexibility", "Most can be developed with clip-and-grow, sacrifice branches, and staged refinement even if the exact response speed differs by species."),
    ],
    bonsaiSpecifics: [
      knowledge("Use clip-and-grow first", "Deciduous broadleaf bonsai usually improves fastest when you alternate free extension with decisive cutback. Taper and branch placement come from cycles, not from timid clipping."),
      knowledge("Work with species vigor", "Some members of the group backbud freely while others are more conservative. Learn the response of the specific tree before assuming it behaves like elm or trident maple."),
      knowledge("Protect inner structure", "Dense outer growth can hide the fact that the interior is dying. Regular thinning for light is a refinement technique, not just a cosmetic one."),
      knowledge("Wire early and briefly", "Young deciduous shoots set quickly and mark quickly. Get the movement you need, then remove the wire before it becomes the most visible feature on the branch."),
    ],
    seasonCalendar: TEMPERATE_DECIDUOUS_CALENDAR,
  },
  "acid-flowering-evergreen": {
    label: "Acid-loving flowering evergreen group",
    scientificName: "Camellia, gardenia, and related evergreen broadleaf species",
    careInstructions: [
      knowledge("Placement", "Give bright light with some protection from the worst afternoon heat. Many of these species want morning sun and airflow but not relentless scorching exposure."),
      knowledge("Water and soil", "Keep moisture even and use slightly acidic media or water habits that do not drive the root zone alkaline. These species dislike both drought shock and sour stagnant soil."),
      knowledge("Feeding", "Feed moderately through the growing season and pay attention to flowering cycles. Flower and bud quality often decline when nutrition is mistimed."),
      knowledge("Winter care", "Protect from hard frost, especially when flower buds are set. Cool bright shelter is usually more helpful than warm dry indoor air."),
    ],
    characteristics: [
      knowledge("Showy bloom", "The appeal lies in glossy evergreen foliage paired with flowers, buds, and often attractive bark or leaf texture."),
      knowledge("Slow refinement", "These species often refine more slowly than elm or ficus and reward patient, horticulturally strong culture more than aggressive intervention."),
      knowledge("Bud visibility", "Because flower buds often form well before the display, pruning decisions must account for what next season is already preparing."),
    ],
    bonsaiSpecifics: [
      knowledge("Prune after flowering", "If flowering matters, heavier pruning should usually follow the bloom period so you do not casually remove the next display."),
      knowledge("Respect root sensitivity", "These species can resent rough repotting. Better to preserve a strong healthy root system and improve slowly than to chase an ideal root prune and lose vigor."),
      knowledge("Wire minimally", "Glossy bark and brittle branch tips often show wire scars quickly. Use pruning and gentle guying wherever possible."),
      knowledge("Choose the year's priority", "A year can be mainly for flowers or mainly for structural progress. Trying to force both at maximum intensity often weakens both outcomes."),
    ],
    seasonCalendar: FLOWERING_FRUITING_CALENDAR,
  },
  azalea: {
    label: "Azalea",
    scientificName: "Rhododendron indicum group",
    careInstructions: [
      knowledge("Placement", "Use sun with protection from the hottest midday exposure, especially while blooming. Blooms last longer when shielded from hard rain and burning heat."),
      knowledge("Watering and soil", "Azaleas should not be allowed to dry out fully and they strongly prefer acidic substrate. Kanuma or another acid-friendly medium usually outperforms generic bonsai soil."),
      knowledge("Feeding", "Feed with attention to the flowering cycle. Too much fertilizer at the wrong time can reduce bloom quality or interfere with next year's bud set."),
      knowledge("Winter protection", "Protect both roots and flower buds below about -5 C in a bonsai pot. The top may be hardy enough, but the pot is the weak point."),
    ],
    characteristics: [
      knowledge("Late-spring flower show", "Azalea is famous for large late-spring floral displays in a wide range of colors and patterns."),
      knowledge("Fine twigging", "It naturally forms many fine twigs and a compact branch structure, which suits bonsai very well once light is managed."),
      knowledge("Brittle old branches", "Older azalea branches become brittle, which strongly influences how safely you can bend and wire the tree."),
    ],
    bonsaiSpecifics: [
      knowledge("Prune right after bloom", "Heavier trimming should happen immediately after flowering. Wait too long and you remove or weaken the buds that ought to become next year's show."),
      knowledge("Remove spent flowers", "Deadheading after bloom keeps energy moving into new buds and branch growth instead of seed production."),
      knowledge("Do not maplize azalea", "Azalea refinement is not full-deciduous refinement. Do not treat it like a maple with blanket defoliation and coarse seasonal abuse."),
      knowledge("Wire gently or not at all", "Branches can crack suddenly, especially on older material. Guy wires, staged pruning, and patient directional growth often work better than direct heavy wire."),
      knowledge("Flowers versus structure", "When branch development is the goal, reduce the flower load. When bloom is the goal, accept that vegetative strengthening for that season will be lower."),
    ],
    seasonCalendar: [
      season("Late winter", "Protect buds and plan the display", "Flower buds are already telling you where the display will be. Avoid rough work that spends those buds by accident."),
      season("Spring", "Protect and enjoy flowering", "Guard blooms from scorching sun, heavy rain, and late frost. Decide whether the tree is in exhibition mode or development mode."),
      season("Immediately after bloom", "Prune and clean up", "This is the key window for shaping, deadheading, and setting up next year's branching and bud positions."),
      season("Summer", "Build health for next year's buds", "Summer is about water, light, and steady health. Healthy post-bloom growth is what produces the next flower cycle."),
      season("Autumn to winter", "Protect the set buds", "Once buds are set, do not casually remove them through tidy-up pruning. Winter protection is for both roots and next season's display."),
    ],
  },
  olive: {
    label: "Olive",
    scientificName: "Olea species",
    careInstructions: MEDITERRANEAN_EVERGREEN_CARE,
    characteristics: [
      knowledge("Silvery foliage", "Olive leaves are narrow and silvery beneath, giving the tree a dry-climate brightness that reads differently from most evergreen broadleaf bonsai."),
      knowledge("Ancient bark and trunk potential", "Olive ages visually through rough bark, hollows, and twisted grain more than through ultra-fine ramification."),
      knowledge("Slow but durable growth", "The species can be slow in some phases, but it holds age and ruggedness extremely well when cultivated patiently."),
    ],
    bonsaiSpecifics: [
      knowledge("Character over delicacy", "Olive bonsai is strongest when you lean into aged trunks, hollows, and dry-climate character rather than trying to make it look like an elm."),
      knowledge("Back budding", "Healthy olives bud back well enough to rebuild structure closer to the trunk. That lets you shorten coarse branches over time instead of living with them forever."),
      knowledge("Deadwood and hollows", "Natural hollows, shari, and weathered carving can suit olive beautifully. Deadwood should still respect the live vein and water line."),
      knowledge("Pruning rhythm", "Let shoots extend enough to strengthen, then cut back hard to two or three leaves. Timid constant nibbling creates clutter more than design."),
    ],
    seasonCalendar: MEDITERRANEAN_EVERGREEN_CALENDAR,
  },
  "mediterranean-evergreen": {
    label: "Mediterranean evergreen broadleaf group",
    scientificName: "Sun-loving evergreen shrub and tree species",
    careInstructions: MEDITERRANEAN_EVERGREEN_CARE,
    characteristics: [
      knowledge("Sun and drought adaptation", "These trees and shrubs are built for intense light, airflow, and moderate dry intervals rather than for wet shade."),
      knowledge("Small evergreen foliage", "Many members of the group carry naturally small leaves and a fine-textured canopy that works well for bonsai."),
      knowledge("Aged bark and deadwood", "Several of these species develop weathered bark, hollows, or drought-hardened character that bonsai can exploit beautifully."),
    ],
    bonsaiSpecifics: [
      knowledge("Preserve inner light", "Dense little evergreen leaves can look tidy while the interior is dying. Thin with discipline so the branch structure stays alive and flexible."),
      knowledge("Clip-and-grow beats panic wiring", "Many of these shrubs refine very well through repeated cutback. Use wire where needed, but do not assume every compact evergreen needs heavy conifer-style wiring."),
      knowledge("Sun drives quality", "Leaf size, internode length, and back budding usually improve with more light rather than less. Weak shade growth is rarely good bonsai material."),
      knowledge("Cold wet roots are the enemy", "Mediterranean species usually suffer more from cold wet winter roots than from dry bright conditions in active growth."),
    ],
    seasonCalendar: MEDITERRANEAN_EVERGREEN_CALENDAR,
  },
  "succulent-dry-climate": {
    label: "Dry-climate succulent group",
    scientificName: "Arid broadleaf and succulent bonsai species",
    careInstructions: [
      knowledge("Heat and sun", "Give as much sun and warmth as the species can comfortably take. These species usually stretch and weaken badly in shade."),
      knowledge("Watering", "Water deeply, then allow a clearer dry interval than you would with deciduous or tropical broadleaf bonsai. Overwatering is a larger risk than brief dryness."),
      knowledge("Soil and feeding", "Use a very fast-draining mineral mix and feed modestly during active growth. Rich wet soil is usually the fastest route to weak roots and coarse growth."),
      knowledge("Winter care", "Many dry-climate species are frost-tender and must be kept warm and bright in winter. The correct balance is bright rest, not dark wet survival mode."),
    ],
    characteristics: [
      knowledge("Water-storing habit", "Thick trunks, fleshy stems, or drought-adapted bark are central to the appeal of these bonsai."),
      knowledge("Fast reaction to shade", "Internodes lengthen and leaf size increases quickly in poor light, so placement quality shows up in the silhouette almost immediately."),
      knowledge("High trunk character", "Many of these species make excellent small to medium bonsai because trunks and bark gain drama faster than fine twigs do."),
    ],
    bonsaiSpecifics: [
      knowledge("Water by the species, not by habit", "Adenium, portulacaria, crassula, bursera, and similar trees all live in the dry-climate zone, but they are not watered identically. Learn the actual growth response of the specific tree."),
      knowledge("Avoid cold root work", "Repot only into warm recovery conditions. Dry-climate trees hate sitting freshly root-pruned in cool damp weather."),
      knowledge("Prune to preserve taper", "These species can thicken quickly in the trunk but also run long and straight fast. Prune with taper and movement in mind rather than waiting for the line to fix itself later."),
      knowledge("Deadwood and hollows", "Many arid species accept hollowing, dry deadwood, and drought-style carving well, but only if the living vascular path is protected."),
    ],
    seasonCalendar: [
      season("Late winter to early spring", "Wake the tree gradually", "Increase light and watering as temperatures rise. Do not rush a dry-climate tree from cool rest into wet soil before it is actively moving."),
      season("Spring", "Repot and cut back in warmth", "Warm spring is usually the safest window for repotting and structural pruning because roots and shoots can respond immediately."),
      season("Summer", "Use sun for compact growth", "Strong summer light is where trunk character and compact foliage are built. Water thoroughly, but allow the species-appropriate dry interval between cycles."),
      season("Autumn", "Reduce water as growth slows", "As temperatures fall, shorten the watering interval and stop forcing rich growth. Soft late growth is especially vulnerable indoors."),
      season("Winter", "Bright dry rest", "Keep the tree bright, warm enough, and distinctly less wet. Winter is health-maintenance season, not push-everything season."),
    ],
  },
  "boxwood-holly-privet": {
    label: "Boxwood, holly, and privet group",
    scientificName: "Evergreen refinement shrub group",
    careInstructions: [
      knowledge("Placement", "Give strong light with some tolerance for partial shade depending on the species. These shrubs usually appreciate airflow more than intense reflected heat."),
      knowledge("Watering", "Keep moisture even in a draining mix. Evergreen refinement shrubs dislike both long drought and constantly sour wet roots."),
      knowledge("Feeding and winter care", "Feed moderately through the growing season and protect roots from hard frost in shallow pots. They are generally tougher than tropicals, but not indifferent to pot exposure."),
    ],
    characteristics: [
      knowledge("Small evergreen foliage", "These species are valued for naturally small leaves and dense twigging that can support compact refined bonsai."),
      knowledge("Slow, steady refinement", "They rarely sprint the way ficus or trident maple do, but they reward long-term patient branch building."),
      knowledge("Strong silhouette control", "Their foliage mass can be kept very neat, which is a strength as long as inner light and branch order are not neglected."),
    ],
    bonsaiSpecifics: [
      knowledge("Thin, do not merely skin-cut", "Because these trees can carry dense shells of foliage, refinement needs internal thinning as well as exterior shortening."),
      knowledge("Clip-and-grow refinement", "Repeated cutback usually does more for density and taper than constant wire. Use wire primarily to set the primary direction and spacing."),
      knowledge("Wire marks show quickly", "Compact evergreen shrubs often have bark that marks or scars faster than expected. Remove wire early and finish with pruning whenever possible."),
      knowledge("Patience is part of the technique", "The reward with these species is dense refined evergreen structure, but it comes from seasons of patient detail rather than dramatic one-time interventions."),
    ],
    seasonCalendar: MEDITERRANEAN_EVERGREEN_CALENDAR,
  },
  citrus: {
    label: "Citrus group",
    scientificName: "Citrus species",
    careInstructions: [
      knowledge("Light and warmth", "Use full sun and warmth in the growing season. Fruit and flower quality depend heavily on light intensity."),
      knowledge("Watering", "Water thoroughly and do not let a fruiting tree dry too hard. At the same time, avoid stale wet soil that reduces root vigor and flowering."),
      knowledge("Feeding", "Feed consistently when growing and fruiting. Citrus in small pots quickly shows nutrient shortage through pale growth and weak flowering."),
      knowledge("Winter care", "Protect from frost and keep bright in winter. Cool bright shelter is better than overheated dry indoor air if fruiting health matters."),
    ],
    characteristics: [
      knowledge("Fragrant bloom and fruit", "Citrus combines glossy evergreen foliage, fragrant flowers, and decorative fruit, which makes it rewarding well beyond the branch structure."),
      knowledge("Fine twigging with thorns", "Some citrus species carry thorns and naturally fine ramification, both of which influence how the silhouette is built and handled."),
      knowledge("Subtropical rhythm", "Citrus behaves like a subtropical evergreen rather than a cold-dormant deciduous tree, so timing follows heat and light more than frost dates."),
    ],
    bonsaiSpecifics: [
      knowledge("Balance fruit load", "Fruit is attractive, but too much crop weakens branch development and can distort a small bonsai's balance. Thin fruit when the display is beginning to cost health."),
      knowledge("Prune after the display", "Heavier pruning is usually best after flowering or fruiting cycles rather than before them. Otherwise you spend the very shoots that would have carried the show."),
      knowledge("Refine with sun and cutback", "Leaf size and twig density improve most through strong light and repeated pruning. Shade-grown citrus quickly becomes coarse and lanky."),
      knowledge("Respect thorns and sap flow", "Thorns can be useful for character or removed for cleanliness, but they are also a sign of vigor. Read the tree before stripping everything for tidiness."),
    ],
    seasonCalendar: TROPICAL_BROADLEAF_CALENDAR,
  },
  "flowering-fruit-rosaceae": {
    label: "Flowering and fruiting rosaceae group",
    scientificName: "Apple, pear, hawthorn, quince, firethorn, and related species",
    careInstructions: TEMPERATE_DECIDUOUS_CARE,
    characteristics: [
      knowledge("Flowers, fruit, and thorns", "Many species in this group offer spring flowers, autumn fruit, and sometimes thorns, which means the tree has more than one design season."),
      knowledge("Short fruiting wood", "Flowering and fruiting often happen on short spurs or older short shoots rather than only on long extension growth."),
      knowledge("Display trade-offs", "Ramification, flowering, fruit size, and fruit count do not all peak in the same year without deliberate management."),
    ],
    bonsaiSpecifics: [
      knowledge("Prune with bloom timing in mind", "Hard pruning at the wrong moment removes the very short fruiting wood that gives the tree its character. Learn where the species carries its flowers and fruit before cutting."),
      knowledge("Thin flowers and fruit", "A heavily loaded bonsai may look impressive for a moment and exhausted for the rest of the year. Thin flower and fruit load when health or branch development demands it."),
      knowledge("Use clip-and-grow for taper", "These species generally build well through repeated extension and cutback, but coarse cuts should be timed so dieback and flower loss do not undo the design."),
      knowledge("Protect the show from late frost", "A spectacular spring display can disappear in one cold night. Placement and timing matter as much as horticultural skill during the bloom window."),
    ],
    seasonCalendar: FLOWERING_FRUITING_CALENDAR,
  },
  cotoneaster: {
    label: "Cotoneaster",
    scientificName: "Cotoneaster species",
    careInstructions: [
      knowledge("Placement", "Give full sun for best flowering and fruiting, with a little relief on the hottest days if needed. Protect the rootball from harder frost in small containers."),
      knowledge("Watering and soil", "Keep moisture fairly even in a free-draining mix. Cotoneaster is tolerant, but bonsai still performs better with steady water and oxygen-rich roots."),
      knowledge("Feeding", "Feed through the growing season to support both flowering and branch density. Excess nitrogen can produce coarse extension at the expense of compact habit."),
    ],
    characteristics: [
      knowledge("Multi-season interest", "Small glossy leaves, white flowers, and bright berries make cotoneaster useful well beyond just the branch silhouette."),
      knowledge("Scale friendliness", "Leaf, flower, and fruit proportions stay convincing in smaller bonsai sizes, which is why cotoneaster is so good for shohin and chuhin."),
      knowledge("Beginner-friendly vigor", "The species is forgiving and responds well to bonsai culture without demanding constant rescue."),
    ],
    bonsaiSpecifics: [
      knowledge("Prune around bloom and berry goals", "If flowers and berries matter, do not shear constantly all season. The shoots you remove may be the ones that would have carried the display."),
      knowledge("Build density by repeated cutback", "Cotoneaster refines quickly through repeated pruning and can build believable small-scale branching faster than many fruiting species."),
      knowledge("Accept the display trade-off", "A tree prepared for maximum berries often needs a little more extension and a little less obsessive tidying than a purely structural refinement tree."),
      knowledge("Use thorn and branch character carefully", "Some cotoneaster carry subtle thorny or spur-like character that adds age and realism if you do not over-clean the tree."),
    ],
    seasonCalendar: FLOWERING_FRUITING_CALENDAR,
  },
  prunus: {
    label: "Prunus group",
    scientificName: "Prunus species",
    careInstructions: TEMPERATE_DECIDUOUS_CARE,
    characteristics: [
      knowledge("Flower-led appeal", "Plum, cherry, and apricot relatives are often grown for their blossom as much as for their branch silhouette."),
      knowledge("Gum and wound sensitivity", "Many Prunus species can react to cuts and stress with dieback, gumming, or weak wound response."),
      knowledge("Elegant bark and twigging", "Smooth bark, seasonal flower color, and fine twig lines make the group visually refined even when branch density is still moderate."),
    ],
    bonsaiSpecifics: [
      knowledge("Time cuts carefully", "Do not approach Prunus like elm. Better timing after bloom or during strong health matters because large cuts can die back or gum badly if made carelessly."),
      knowledge("Seal and preserve", "Clean cuts, hygiene, and sometimes wound sealing are worth the effort because the group can be less forgiving about injury than tougher deciduous species."),
      knowledge("Flowers versus structure", "As with other flowering bonsai, years devoted to bloom are not usually the same years devoted to maximum branch development."),
      knowledge("Wire young wood", "Prunus branches stiffen and scar quickly. Movement is best set early, while mature bark is usually best protected rather than heavily wired."),
    ],
    seasonCalendar: FLOWERING_FRUITING_CALENDAR,
  },
  podocarpus: {
    label: "Podocarpus",
    scientificName: "Podocarpus species",
    careInstructions: TROPICAL_BROADLEAF_CARE,
    characteristics: [
      knowledge("Needle-like broadleaf", "Podocarpus reads visually like a conifer, but its growth response is closer to a tropical evergreen broadleaf."),
      knowledge("Dark mature bark", "Older trees develop dark furrowed bark and quiet elegant structure rather than flashy leaf color or bloom."),
      knowledge("Warm-climate strength", "The species is popular because it handles bonsai culture well as long as frost is avoided and light stays strong."),
    ],
    bonsaiSpecifics: [
      knowledge("Back budding and pruning", "Healthy podocarpus responds well to pruning and can bud on older wood, which makes branch correction more forgiving than with many true conifers."),
      knowledge("Pad building through repetition", "Let shoots extend enough to strengthen, then cut back to a few leaves to build dense masses. Good pads come from cycles, not from one-time tightening."),
      knowledge("Leaf proportion through light", "Needle length improves most through strong light, steady feeding, and repeated pruning rather than through gimmick techniques."),
      knowledge("Wire with care", "Young shoots wire easily but older branches stiffen. Use pruning and guy wires when bending old wood starts to feel risky."),
    ],
    seasonCalendar: TROPICAL_BROADLEAF_CALENDAR,
  },
  wisteria: {
    label: "Wisteria",
    scientificName: "Wisteria species",
    careInstructions: [
      knowledge("Sun", "Full sun is essential if you want reliable flowering. Weak light usually produces long vegetative runners without the floral payoff."),
      knowledge("Water and feeding", "Wisteria drinks heavily in active growth and should not be allowed to dry hard in summer. Feed strongly when building health, but manage nitrogen if the next bloom cycle matters."),
      knowledge("Winter care", "The top is hardy, but roots in containers need protection. A cool frost-free winter shelter is often ideal for bonsai."),
    ],
    characteristics: [
      knowledge("Spring racemes", "Wisteria is prized for its long drooping flower clusters, especially on strong Japanese forms."),
      knowledge("Vine instinct", "It is naturally a vigorous climber, so its default behavior is to run, twist, and smother rather than calmly hold a bonsai silhouette."),
      knowledge("Toxic seed pods", "Seed pods are visually interesting but poisonous and also consume energy that might be better spent on structure or next year's flowering."),
    ],
    bonsaiSpecifics: [
      knowledge("Flowers versus silhouette", "A good wisteria bonsai is a compromise between the floral show and the fact that the species wants to become a vine immediately afterward."),
      knowledge("Pruning calendar matters", "Structural pruning, summer cutback, and flower-bud preservation all sit on different timing windows. Wrong timing costs either flowers or shape."),
      knowledge("Scale choice", "Wisteria usually reads best in medium to large bonsai because the hanging flower clusters need real vertical room."),
      knowledge("Root work restraint", "Once a specimen is nearing exhibition bloom quality, root work must be conservative. Severe repotting often buys vigor at the price of flowers."),
    ],
    seasonCalendar: [
      season("Late winter", "Protect flower buds", "As spring approaches, keep the tree cold enough to stay dormant but safe enough that swelling flower buds are not damaged."),
      season("Spring", "Flowering and restraint", "During bloom, the job is mostly protection and observation. Decide early whether this season is about display or about hard development."),
      season("After flowering", "Cut back and reset the silhouette", "This is the major pruning window for controlling runners and reclaiming the bonsai shape after the flower show passes."),
      season("Summer", "Control rampant tendrils", "Summer growth can become wild quickly. Repeated reduction is necessary if the tree is to remain a bonsai instead of a vine on a stick."),
      season("Autumn to winter", "Set buds and protect roots", "Reduce heavy feeding, let the tree harden, and protect the rootball from frost while next spring's flower potential is set."),
    ],
  },
  bougainvillea: {
    label: "Bougainvillea",
    scientificName: "Bougainvillea species",
    careInstructions: [
      knowledge("Heat and sun", "Bougainvillea wants intense sun and warmth. Flowering quality is tied directly to light and heat."),
      knowledge("Watering", "Water thoroughly and let the mix approach dryness between waterings. Constantly wet roots reduce vigor and flower response."),
      knowledge("Feeding and winter care", "Feed during active growth, but avoid turning the tree into lush green extension at the expense of bloom. Protect from cold once temperatures fall toward 10 C."),
    ],
    characteristics: [
      knowledge("Bract display", "The bright papery display is carried by bracts rather than the tiny true flowers, which is why the tree can look intensely floral for long periods."),
      knowledge("Rugged bark and thorns", "Older bougainvillea develops furrowed bark and often thorny branches, both of which influence styling and handling."),
      knowledge("Subtropical rhythm", "It behaves as a heat-loving subtropical and is never at its best in a cold dim environment."),
    ],
    bonsaiSpecifics: [
      knowledge("Prune after flowering", "Heavier cutting is usually best done after a bloom cycle rather than right before one. The tree flowers better when allowed some controlled extension."),
      knowledge("Brittle branch warning", "Older branches can snap or scar easily, so guy wires and pruning are often safer than strong direct bending."),
      knowledge("Root work restraint", "Bougainvillea can resent severe root disturbance. Staged repotting usually outperforms heroic one-time reduction."),
      knowledge("Flowering versus tight silhouette", "A tightly clipped green outline is often the enemy of a heavy floral show. Decide which outcome the season is for."),
    ],
    seasonCalendar: TROPICAL_BROADLEAF_CALENDAR,
  },
  ginkgo: {
    label: "Ginkgo",
    scientificName: "Ginkgo biloba",
    careInstructions: TEMPERATE_DECIDUOUS_CARE,
    characteristics: [
      knowledge("Late bud break", "Ginkgo often opens its leaves very late in spring, which helps it dodge some of the frosts that catch earlier-budding deciduous trees."),
      knowledge("Fan leaves and yellow autumn", "Its fan-shaped leaves and clear yellow autumn color make it unmistakable in bonsai."),
      knowledge("Simple strong structure", "Ginkgo tends to express age and character through clean structure and leaf presence more than through extremely fine ramification."),
    ],
    bonsaiSpecifics: [
      knowledge("Back budding is limited", "Ginkgo should not be treated like elm or trident maple. Preserve short shoots and buds where future structure is needed because old bare wood is not highly forgiving."),
      knowledge("Build short shoots", "Refinement is about creating and maintaining useful short shoots and controlled extension rather than about aggressive whole-tree defoliation."),
      knowledge("Wire young growth only", "Young shoots can be moved, but older wood becomes awkward and stiff. Clip-and-grow often gives cleaner results than forcing mature branches."),
      knowledge("Design to the species", "Ginkgo is strongest with a simpler, cleaner branch structure than many deciduous species. Do not overcomplicate the canopy trying to make it act like a maple."),
    ],
    seasonCalendar: [
      season("Late winter", "Repot before the late wake-up", "Use the late-winter window for repotting and structural decisions before the species wakes, even though the visible push arrives late."),
      season("Spring", "Protect the first leaves from surprise frost", "Because the leaves emerge late, one warm period can expose them suddenly. Protect new foliage if a cold snap is forecast."),
      season("Summer", "Drive compact growth with sun", "Strong summer light and repeated directional pruning help keep extension compact and leaves smaller."),
      season("Autumn", "Use the yellow-drop window", "Autumn color gives a clear read on health and timing. After leaf drop, branch order and next-year decisions become visible."),
      season("Winter", "Protect the rootball and plan structure", "Ginkgo is hardy, but bonsai roots still need protection from extreme cold. Winter is also when the simple structural line is easiest to evaluate."),
    ],
  },
  lagerstroemia: {
    label: "Crape myrtle",
    scientificName: "Lagerstroemia indica",
    careInstructions: [
      knowledge("Sun and warmth", "Use full sun and good summer heat. Flowering and bark quality both improve when the tree is grown strongly and brightly."),
      knowledge("Watering", "Keep moisture even in active growth. Strong summer flowering and repeated pruning both demand more water than the fine twig silhouette may suggest."),
      knowledge("Feeding and winter care", "Feed through the growing season and protect roots in harder freeze. The species wants a real winter rest but not a frozen pot for extended periods."),
    ],
    characteristics: [
      knowledge("Flowering on new wood", "Crape myrtle flowers on current season growth, which is central to how it should be pruned."),
      knowledge("Exfoliating bark", "The smooth peeling bark adds age and visual value even when the tree is not in bloom."),
      knowledge("Small leaves and fine growth", "The species reduces well and can carry a delicate deciduous silhouette when healthy."),
    ],
    bonsaiSpecifics: [
      knowledge("Prune with flowering biology in mind", "Because flowers appear on new wood, pruning timing determines whether you get bloom, branch density, or both in balance."),
      knowledge("Use repeated cutback", "Let shoots run enough to support strength and flower potential, then reduce them to preserve structure. Constant timid clipping does not build convincing branch order."),
      knowledge("Protect bark quality", "The bark is part of the beauty, so watch wire carefully and prefer pruning or guying where scars would spoil the trunk and primary branches."),
      knowledge("Decide the season's goal", "A season aimed at maximum flowering is not identical to a season aimed at heavy structural refinement. Strong bonsai culture chooses which matters more."),
    ],
    seasonCalendar: FLOWERING_FRUITING_CALENDAR,
  },
  "fruiting-subtropical": {
    label: "Subtropical fruiting broadleaf group",
    scientificName: "Warm-climate flowering and fruiting species",
    careInstructions: TROPICAL_BROADLEAF_CARE,
    characteristics: [
      knowledge("Flowers and edible or ornamental fruit", "These species combine evergreen or warm-climate foliage with flowers and fruit, which makes them highly rewarding but also energetically demanding."),
      knowledge("Heat dependence", "Fruit set, internode length, and ripening all depend strongly on heat and light. Weak light produces long growth and little real display."),
      knowledge("Variable leaf and bark character", "Some members of the group carry tiny leaves and smooth bark, others rough bark or larger leaves, but their bonsai strategy often shares the same trade-offs."),
    ],
    bonsaiSpecifics: [
      knowledge("Thin crop for health", "Too much fruit weakens branch development and can distort a bonsai's balance. Thinning fruit is often a bonsai technique, not a failure."),
      knowledge("Prune after the display window", "Major pruning is safer after flowering or fruiting cycles rather than before them. Otherwise you cut off the very short shoots that carry the show."),
      knowledge("Let extension do some work", "A tree cannot always be held as a tight green cloud if you also want flowers and fruit. Controlled extension is often part of the process."),
      knowledge("Use warm-season repotting", "Root work is best scheduled into real warmth so the tree can recover and still support the next reproductive cycle."),
    ],
    seasonCalendar: TROPICAL_BROADLEAF_CALENDAR,
  },
  oak: {
    label: "Oak family",
    scientificName: "Quercus species",
    careInstructions: TEMPERATE_DECIDUOUS_CARE,
    characteristics: [
      knowledge("Strong apical character", "Oaks often show strong apical dominance and a rugged trunk-first aesthetic rather than immediate fine twigging."),
      knowledge("Species diversity", "Evergreen and deciduous oaks both appear in bonsai, but they broadly share a need for strong light, patience, and decisive structure."),
      knowledge("Age in bark and branch line", "Old oak character often comes from bark, branch weight, and silhouette more than from tiny leaves alone."),
    ],
    bonsaiSpecifics: [
      knowledge("Patience with leaf reduction", "Oaks are not magic leaf-reduction species. Leaf size improves slowly through strong health, good light, and repeated cutback, not by forcing defoliation every year."),
      knowledge("Build with strong shoots", "Allow vigorous shoots to run where you need thickening, then cut back hard to shorter internodes and secondary branching."),
      knowledge("Old wood budding varies", "Some oaks backbud well enough to correct structure, others much less so. Preserve useful inner growth and do not assume every bare section will refill."),
      knowledge("Respect the species' mass", "Many great oak bonsai feel old and weighty rather than hyper-refined. Heavy branch lines and good taper often matter more than ultimate twig count."),
    ],
    seasonCalendar: TEMPERATE_DECIDUOUS_CALENDAR,
  },
  "willow-poplar": {
    label: "Willow and poplar group",
    scientificName: "Salix and Populus species",
    careInstructions: [
      knowledge("Sun and water", "These species want strong light and generous water. They dry faster and complain faster than many deciduous species in summer."),
      knowledge("Soil and feeding", "Use a draining mix that still carries moisture and feed through the growing season. Fast extension burns through both water and fertilizer quickly."),
      knowledge("Winter care", "Give normal deciduous dormancy and protect the rootball from extreme freeze in the pot."),
    ],
    characteristics: [
      knowledge("Fast coarse extension", "Willows and poplars run quickly, which makes them powerful development material and high-maintenance refinement material."),
      knowledge("Flexible young growth", "New shoots are often flexible and fast, but branch structure can become messy quickly if pruning lags."),
      knowledge("Moisture demand", "The species' love of water makes summer management the central horticultural challenge in bonsai culture."),
    ],
    bonsaiSpecifics: [
      knowledge("Prune constantly for structure", "If you let extension run unchecked, the design becomes coarse almost immediately. Repeated cutback is the price of refinement with these species."),
      knowledge("Use their speed", "Fast growth is not a flaw if you are still building taper, branch thickness, or root spread. Let them run when a job needs doing, then rein them back in."),
      knowledge("Repot by vigor", "Root work should follow health and water demand. Strong trees recover well, but weak trees collapse quickly if you take roots and then let them dry."),
      knowledge("Naturalistic styling often suits them", "Their branch behavior often looks more convincing in looser, natural forms than in tightly geometric pad structures."),
    ],
    seasonCalendar: TEMPERATE_DECIDUOUS_CALENDAR,
  },
  "myrtle-family": {
    label: "Myrtle and tea-tree family",
    scientificName: "Myrtaceae and related fine-foliage warm-climate species",
    careInstructions: TROPICAL_BROADLEAF_CARE,
    characteristics: [
      knowledge("Fine foliage and bark", "Many members of this group have naturally small leaves or scale-like fine foliage, along with interesting papery or peeling bark."),
      knowledge("Flowering potential", "Flowers can be an important secondary display, but the small foliage and fine twigging are often just as valuable."),
      knowledge("Warm sunny response", "These species are usually best in bright, warm, airy positions and lose quality quickly in dim indoor conditions."),
    ],
    bonsaiSpecifics: [
      knowledge("Refine through repeated pruning", "Most of these species respond well to repeated cutback and can build excellent fine branch detail when strong."),
      knowledge("Prune after blooms if flowers matter", "Where flowering is important, time heavier pruning after the display so short flowering wood is not removed too casually."),
      knowledge("Use wire on young shoots only", "Many shoots set early and scar early, so wire is mainly a young-growth tool. Later detail work is usually better done with pruning."),
      knowledge("Exploit bark texture", "Paperbark and fine twigging can create a lot of age even before the trunk becomes massive. Do not style away the subtle bark character."),
    ],
    seasonCalendar: TROPICAL_BROADLEAF_CALENDAR,
  },
  casuarina: {
    label: "Casuarina",
    scientificName: "Casuarina equisetifolia",
    careInstructions: [
      knowledge("Heat, sun, and airflow", "Casuarina wants full sun, warmth, and air movement. It is not a frost-hardy pine substitute and should be treated as a warm-climate tree."),
      knowledge("Watering and feed", "Give more water and fertilizer than the fine needle-like branchlets suggest. It is a fast, hungry tree when actively growing."),
      knowledge("Winter care", "Protect from frost and keep bright in winter. A cold wet dormant treatment suitable for temperate pines is the wrong approach here."),
    ],
    characteristics: [
      knowledge("Needle-like branchlets", "Casuarina looks conifer-like, but its growth rhythm and horticulture are more subtropical and fast-moving."),
      knowledge("Coastal vigor", "The species is adapted to strong light and wind and can grow aggressively when healthy."),
      knowledge("Elegant informal line", "Its thin branchlets and flexible growth lend themselves to elegant informal and literati-like styling."),
    ],
    bonsaiSpecifics: [
      knowledge("Treat it as a warm-climate fast grower", "Do not apply pine rules just because it looks needled. Casuarina responds best to warm-season growth management and repeated directional pruning."),
      knowledge("Back budding is useful", "Healthy trees can bud back well enough to support structural correction, which is one reason the species is loved in some warm climates."),
      knowledge("Wire while shoots are young", "Young branches move well and set fast. Old branches lose that flexibility quickly."),
      knowledge("Feed for density", "Sparse underfed casuarina rarely becomes good bonsai. Density comes from strong growth, repeated cutback, and enough food to support the cycle."),
    ],
    seasonCalendar: TROPICAL_BROADLEAF_CALENDAR,
  },
} as const satisfies Record<string, SpeciesCareProfile>;

type SpeciesCareProfileKey = keyof typeof PROFILE_LIBRARY;

const PROFILE_KEY_BY_SLUG = new Map<string, SpeciesCareProfileKey>([
  ["acer-palmatum", "japanese-maple"],
  ["acer-buergerianum", "trident-maple"],
  ["korean-beech", "hornbeam-beech"],
  ["ulmus-parvifolia", "chinese-elm"],
  ["zelkova-serrata", "japanese-zelkova"],
]);

const PROFILE_KEYS_BY_PREFIX = [
  { profileKey: "maple-family", prefixes: ["acer"] },
  { profileKey: "juniper", prefixes: ["juniperus"] },
  { profileKey: "pine", prefixes: ["pinus"] },
  { profileKey: "cool-climate-conifer", prefixes: ["abies", "picea", "tsuga"] },
  { profileKey: "cedar-cypress-conifer", prefixes: ["cedrus", "calocedrus", "chamaecyparis", "cryptomeria", "cupressus", "platycladus", "thuja"] },
  { profileKey: "deciduous-conifer", prefixes: ["larix", "metasequoia", "pseudolarix", "taxodium"] },
  { profileKey: "yew-family", prefixes: ["taxus", "cephalotaxus"] },
  { profileKey: "redwood-family", prefixes: ["sequoia", "sequoiadendron"] },
  { profileKey: "elm-family", prefixes: ["ulmus"] },
  { profileKey: "japanese-zelkova", prefixes: ["zelkova"] },
  { profileKey: "hornbeam-beech", prefixes: ["carpinus", "fagus", "ostrya"] },
  { profileKey: "hackberry", prefixes: ["celtis"] },
  { profileKey: "temperate-deciduous-broadleaf", prefixes: ["alnus", "berberis", "betula", "forsythia", "robinia", "stewartia", "styphnolobium", "syringa", "tamarix", "viburnum", "zanthoxylum"] },
  { profileKey: "tropical-broadleaf-indoor", prefixes: ["carmona", "ehretia", "premna", "schefflera", "serissa", "tabernaemontana", "terminalia", "wrightia", "pithecellobium", "murraya", "myrsine", "duranta", "sageretia", "tamarindus"] },
  { profileKey: "tropical-flowering-tree", prefixes: ["albizia", "bauhinia", "calliandra", "delonix", "hibiscus", "jacaranda", "senna"] },
  { profileKey: "acid-flowering-evergreen", prefixes: ["camellia", "gardenia", "loropetalum", "rhaphiolepis"] },
  { profileKey: "azalea", prefixes: ["azalea", "rhododendron"] },
  { profileKey: "mediterranean-evergreen", prefixes: ["arbutus", "dodonaea", "elaeagnus", "osmanthus", "phillyrea", "pistacia", "teucrium"] },
  { profileKey: "olive", prefixes: ["olea"] },
  { profileKey: "succulent-dry-climate", prefixes: ["adenium", "bursera", "crassula", "fouquieria", "operculicarya", "portulacaria"] },
  { profileKey: "boxwood-holly-privet", prefixes: ["buxus", "euonymus", "ilex", "ligustrum", "lonicera"] },
  { profileKey: "myrtle-family", prefixes: ["baeckea", "callistemon", "eugenia", "leptospermum", "melaleuca", "myrtus", "syzygium"] },
  { profileKey: "ficus", prefixes: ["ficus"] },
  { profileKey: "citrus", prefixes: ["citrus"] },
  { profileKey: "flowering-fruit-rosaceae", prefixes: ["chaenomeles", "crataegus", "cydonia", "malus", "mespilus", "pseudocydonia", "pyracantha", "pyrus"] },
  { profileKey: "cotoneaster", prefixes: ["cotoneaster"] },
  { profileKey: "prunus", prefixes: ["prunus"] },
  { profileKey: "fruiting-subtropical", prefixes: ["carissa", "diospyros", "plinia", "psidium", "punica"] },
  { profileKey: "podocarpus", prefixes: ["podocarpus"] },
  { profileKey: "wisteria", prefixes: ["wisteria"] },
  { profileKey: "bougainvillea", prefixes: ["bougainvillea"] },
  { profileKey: "ginkgo", prefixes: ["ginkgo"] },
  { profileKey: "lagerstroemia", prefixes: ["lagerstroemia"] },
  { profileKey: "oak", prefixes: ["quercus"] },
  { profileKey: "willow-poplar", prefixes: ["salix", "populus"] },
  { profileKey: "casuarina", prefixes: ["casuarina"] },
] as const satisfies ReadonlyArray<{ profileKey: SpeciesCareProfileKey; prefixes: readonly string[] }>;

const PROFILE_KEY_BY_PREFIX = new Map<string, SpeciesCareProfileKey>(
  PROFILE_KEYS_BY_PREFIX.flatMap(({ profileKey, prefixes }) => prefixes.map((prefix) => [prefix, profileKey] as const)),
);

export function getSpeciesCareProfileBySlug(slug: string | null | undefined): SpeciesCareProfile | null {
  if (!slug) {
    return null;
  }

  const exactProfileKey = PROFILE_KEY_BY_SLUG.get(slug);
  if (exactProfileKey) {
    return PROFILE_LIBRARY[exactProfileKey];
  }

  const prefixProfileKey = PROFILE_KEY_BY_PREFIX.get(slug.split("-")[0]);
  if (!prefixProfileKey) {
    return null;
  }

  return PROFILE_LIBRARY[prefixProfileKey];
}
