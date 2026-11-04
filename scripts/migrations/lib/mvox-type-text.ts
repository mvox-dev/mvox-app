// Label and description Entu shows on each extension type-def, by type name (en, et).
export interface TypeText {
	labelEn: string;
	labelEt: string;
	descriptionEn: string;
	descriptionEt: string;
}

export const TYPE_TEXT: Readonly<Record<string, TypeText>> = {
	ink_layer: {
		labelEn: 'Part marks',
		labelEt: 'Partii märkmed',
		descriptionEn:
			"A singer's own marks on one part: her ink per page and the page she was on. Created by her with her own key; private, its own grants. mvox app extension.",
		descriptionEt:
			'Laulja enda märkmed ühel partiil: tema märkmed lehtede kaupa ja leht, millel ta oli. Ta loob selle oma võtmega; privaatne, omaenda õigustega. Mvoxi rakenduse laiendus.'
	}
};

// (*MVOX:Josquin*)
