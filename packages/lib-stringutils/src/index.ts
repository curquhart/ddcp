export const toWords = (value: string): string => {
    return value.replace(/[a-zA-Z0-9]+/g, (match) => {
        return match[0].toUpperCase() + match.substr(1).toLowerCase();
    }).replace(/[^a-zA-Z0-9]+/, ' ');
};
