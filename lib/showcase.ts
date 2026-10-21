export interface ShowcasePair {
  id: string;
  beforeSrc: string;
  afterSrc: string;
  caption: string;
  /** Describes the scene - " (before)" / " (after)" is appended for each image. */
  alt: string;
}

/**
 * To add a pair: drop two 3:4 portrait images (900x1200 jpg is plenty) into
 * /public/showcase and add one object here. Leave the array empty and the whole
 * section disappears from the homepage.
 */
export const SHOWCASE: ShowcasePair[] = [
  {
    id: "yard-01",
    beforeSrc: "/showcase/yard-01-before.jpg",
    afterSrc: "/showcase/yard-01-after.jpg",
    caption: "Platinum Village — side yard, weeds cleared",
    alt: "Side yard beside a water tank and washing line, covered in weeds, then cleared and raked",
  },
  {
    id: "yard-03",
    beforeSrc: "/showcase/yard-03-before.jpg",
    afterSrc: "/showcase/yard-03-after.jpg",
    caption: "Platinum Village — front yard, raked level",
    alt: "Front yard with patchy, uneven ground and scattered weeds, then cleared and evenly raked",
  },
];
