import DOMPurify from 'dompurify';

import Card from 'react-bootstrap/Card';
import Alert from 'react-bootstrap/Alert';

const DescriptionCard = (props) => {
    const createMarkup = (html) => {
        return {
            __html: DOMPurify.sanitize(html),
        };
    };
    return (
        <>
            {props.ticket.description && (
                <Card>
                    <Card.Body>
                        <p className='lead'>
                            <span
                                dangerouslySetInnerHTML={createMarkup(
                                    props.ticket.description
                                )}
                            />
                        </p>
                    </Card.Body>
                </Card>
            )}

            {!props.ticket.description && (
                <Alert variant='light'>Нет описания</Alert>
            )}
        </>
    );
};

export default DescriptionCard;
